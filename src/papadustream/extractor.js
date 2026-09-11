/**
 * Extractor for Papadustream (papadustream.club)
 * Séries TV uniquement — les films sont protégés par authentification.
 *
 * Cache intelligent :
 * - TTL séparé pour succès (5min) et échec (30s)
 * - Limite de taille avec éviction LRU
 * - Nettoyage périodique des entrées expirées
 * - Cache clé sécurisé (normalisation)
 *
 * Fonctionnement :
 * 1. Convertit TMDB ID → IMDb ID (TMDB external_ids, fallback recherche)
 * 2. Résout les épisodes cibles via ArmSync (resolveTargetEpisodes)
 * 3. Fetch la page série sur papadustream (avec cache)
 * 4. Extrait les URLs HLS (playlist.m3u8) du HTML de la page
 * 5. Filtre par saison et épisode cibles
 * 6. Crée des objets stream standardisés via toStream
 * 7. Les playlists HLS contiennent multi-qualité (360p→1080p) et multi-audio
 */

import { fetchText, BASE_URL, setCurrentSignal } from './http.js';
import { safeFetch, isAborted } from '../utils/resolvers.js';
import { toStream, resolveTargetEpisodes } from '../utils/dle-extractor.js';
import { createCache } from '../utils/cache.js';

const TMDB_API_KEY = "8265bd1679663a7ea12ac168da84d2e8";
const TMDB_API_BASE = "https://api.themoviedb.org/3";

// ─── Cache intelligent (partagé) ─────────────────────────────────────────────
const withCache = createCache('pd', 'Papadustream');

// ─── TMDB Helpers ───────────────────────────────────────────────────────────

/**
 * Récupère l'IMDb ID (tt...) depuis TMDB via external_ids.
 */
async function getImdbIdFromTmdb(tmdbId, isMovie) {
    const kind = isMovie ? 'movie' : 'tv';
    const url = `${TMDB_API_BASE}/${kind}/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`;
    return withCache(`imdb_${kind}_${tmdbId}`, async () => {
        try {
            const res = await safeFetch(url);
            if (!res) return null;
            const data = await res.json();
            if (!data || data.success === false) return null;
            const imdbId = data?.imdb_id;
            if (!imdbId || typeof imdbId !== 'string' || !imdbId.startsWith('tt')) return null;
            console.log(`[Papadustream] TMDB ${tmdbId} → IMDb ${imdbId}`);
            return imdbId;
        } catch (e) {
            console.warn(`[Papadustream] TMDB error: ${e?.message}`);
            return null;
        }
    });
}

/**
 * Récupère le titre d'un contenu TMDB (pour fallback recherche).
 */
async function getTmdbTitle(tmdbId, isMovie) {
    const kind = isMovie ? 'movie' : 'tv';
    const url = `${TMDB_API_BASE}/${kind}/${tmdbId}?api_key=${TMDB_API_KEY}&language=fr-FR`;
    return withCache(`title_${kind}_${tmdbId}`, async () => {
        try {
            const res = await safeFetch(url);
            if (!res) return null;
            const data = await res.json();
            if (!data || data.success === false) return null;
            return data.name || data.title || null;
        } catch (e) {
            console.warn(`[Papadustream] TMDB title error: ${e?.message}`);
            return null;
        }
    });
}

/**
 * Cherche une série OU un film sur Papadustream par titre, retourne l'IMDb ID.
 * Chemins vérifiés en live : /series/tt… et /films/tt…
 */
async function searchSiteByTitle(title, isMovie) {
    const searchUrl = `${BASE_URL}/search?q=${encodeURIComponent(title)}`;
    const kind = isMovie ? 'films' : 'series';
    return withCache(`search_${kind}_${title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`, async () => {
        try {
            const html = await fetchText(searchUrl);
            if (!html) return null;
            const siteRegex = new RegExp(`\\/${kind}\\/(tt\\d+)`, 'g');
            let match;
            const found = [];
            while ((match = siteRegex.exec(html)) !== null) {
                found.push(match[1]);
            }
            if (found.length > 0) {
                const imdbId = found[0];
                console.log(`[Papadustream] Search "${title}" → ${imdbId} (${found.length} results)`);
                return imdbId;
            }
            console.warn(`[Papadustream] No results for "${title}"`);
            return null;
        } catch (e) {
            console.warn(`[Papadustream] Search error: ${e?.message}`);
            return null;
        }
    });
}

/**
 * Résout un TMDB ID en IMDb ID utilisable sur Papadustream.
 */
async function resolveImdbId(tmdbId, isMovie) {
    let imdbId = await getImdbIdFromTmdb(tmdbId, isMovie);
    if (imdbId) return imdbId;

    console.log(`[Papadustream] Title search fallback for TMDB ${tmdbId}...`);
    const title = await getTmdbTitle(tmdbId, isMovie);
    if (title) {
        const mainTitle = title.split(':')[0].trim();
        imdbId = await searchSiteByTitle(mainTitle, isMovie);
        if (imdbId) return imdbId;
        imdbId = await searchSiteByTitle(title, isMovie);
        if (imdbId) return imdbId;
    }

    console.warn(`[Papadustream] IMDb ID not found for TMDB ${tmdbId}`);
    return null;
}

// ─── Extraction HLS ──────────────────────────────────────────────────────────

/**
 * Parse le HTML d'une page série pour extraire les URLs HLS
 * correspondant à la saison et l'épisode demandés.
 *
 * Pattern HLS : /hls/s{N}/serial/{IMDB_ID}/{SEASON}/{EPISODE}/playlist.m3u8
 */
function extractHlsUrls(html, season, episode) {
    if (!html) return [];

    const results = [];
    const hlsRegex = /\/hls\/s\d+\/serial\/tt\d+\/(\d+)\/(\d+)\/playlist\.m3u8/g;
    let match;

    while ((match = hlsRegex.exec(html)) !== null) {
        const epSeason = parseInt(match[1], 10);
        const epNumber = parseInt(match[2], 10);

        if (epSeason === season && epNumber === episode) {
            const fullUrl = `${BASE_URL}${match[0]}`;
            console.log(`[Papadustream] Found HLS: S${epSeason}E${epNumber}`);
            results.push(fullUrl);
        }
    }

    return results;
}

// ─── Main Export ─────────────────────────────────────────────────────────────

/**
 * Point d'entrée principal — séries ET films.
 * ⚠️ Dispatch : Nuvio passe 'series' (jamais 'tv') — l'ancien code
 * testait mediaType !== 'tv' → toutes les séries étaient rejetées.
 */
export async function extractStreams(tmdbId, mediaType, season, episode, options = {}) {
    const signal = options?.signal || null;
    if (isAborted(signal)) return [];
    setCurrentSignal(signal);

    const isTv = mediaType === 'series' || mediaType === 'tv';
    const isMovie = mediaType === 'movie';
    if (!isTv && !isMovie) {
        console.log(`[Papadustream] Unsupported: ${mediaType} (TV/movies only)`);
        return [];
    }

    const startTime = Date.now();

    console.log(`[Papadustream] Looking for S${season || 1}E${episode || 1} (TMDB: ${tmdbId})`);

    // Étape 1: Résoudre TMDB ID → IMDb ID
    // Les films ont leur propre chemin (/films/tt…) — le fallback recherche
    // titre doit cibler la bonne catégorie selon le type.
    const imdbId = await resolveImdbId(tmdbId, isMovie);
    if (!imdbId) {
        console.warn(`[Papadustream] Could not resolve IMDb ID for TMDB ${tmdbId}`);
        return [];
    }

    // Étape 2 (séries) : Résoudre les épisodes cibles via ArmSync
    let targetEpisodes = [1];
    if (isTv) {
        targetEpisodes = await resolveTargetEpisodes(tmdbId, 'tv', season, episode, {
            startTime,
            budgetMs: 45000,
        });
        console.log(`[Papadustream] Target episodes: ${targetEpisodes}`);
    }

    // Étape 3: Fetch la page (avec cache intelligent) — /series/tt… ou /films/tt…
    const pagePath = isMovie ? `/films/${imdbId}` : `/series/${imdbId}`;
    const pageUrl = `${BASE_URL}${pagePath}`;
    let html = await withCache(`page_${imdbId}_${isMovie ? 'mv' : 'tv'}`, async () => {
        return await fetchText(pageUrl);
    });
    if (!html) {
        console.warn(`[Papadustream] Series page not accessible: ${seriesUrl}`);
        return [];
    }
    // Vérification: la page doit contenir des URLs HLS
    if (!html.includes('/hls/') || !html.includes('playlist.m3u8')) {
        console.warn(`[Papadustream] Page has no HLS content (${html.length} bytes), retrying...`);
        const retryHtml = await fetchText(pageUrl);
        if (retryHtml && retryHtml.includes('playlist.m3u8')) {
            html = retryHtml;
        } else {
            return [];
        }
    }

    // Étape 4: Extraire les URLs HLS pour chaque épisode cible
    // Séries : /hls/s{N}/serial/tt…/{SAISON}/{EPISODE}/playlist.m3u8
    // Films  : /hls/s{N}/movie/tt…/playlist.m3u8 (vérifié en live)
    const targetSeason = Number(season) || 1;
    const streams = [];
    const seenUrls = new Set();

    if (isMovie) {
        const movieRe = new RegExp(`\\/hls\\/s\\d+\\/movie\\/${imdbId}\\/playlist\\.m3u8`, 'g');
        const m = movieRe.exec(html);
        if (m) {
            const url = `${BASE_URL}${m[0]}`;
            const stream = toStream(url, 'VF', 'Papadustream', BASE_URL, {
                quality: 'HD',
                title: 'HLS',
            });
            stream.type = 'hls';
            streams.push(stream);
            console.log(`[Papadustream] Movie HLS found`);
        } else {
            console.log(`[Papadustream] No movie HLS for ${imdbId}`);
        }
    } else {
    for (const ep of targetEpisodes) {
        const urls = extractHlsUrls(html, targetSeason, ep);
        for (const url of urls) {
            if (seenUrls.has(url)) continue;
            seenUrls.add(url);

            // Utiliser toStream pour standardiser l'objet stream
            const stream = toStream(url, 'VF', 'Papadustream', BASE_URL, {
                quality: 'HD',
                title: `S${targetSeason}E${ep} HLS`,
            });
            // Ajouter le type manuellement (toStream ne gère pas type/subType)
            stream.type = 'hls';
            streams.push(stream);
        }
        if (streams.length > 0) break;
    }
    } // fin branche séries

    // Étape 5 (séries) : Fallback épisode-1 si pas trouvé
    // (le fallback épisode-1 ne s'applique qu'aux séries)
    if (isTv && streams.length === 0 && targetEpisodes[0] > 1) {
        const prevEp = targetEpisodes[0] - 1;
        const urls = extractHlsUrls(html, targetSeason, prevEp);
        for (const url of urls) {
            if (seenUrls.has(url)) continue;
            seenUrls.add(url);
            const stream = toStream(url, 'VF', 'Papadustream', BASE_URL, {
                quality: 'HD',
                title: `S${targetSeason}E${prevEp} HLS (fallback)`,
            });
            stream.type = 'hls';
            streams.push(stream);
        }
        if (streams.length > 0) {
            console.log(`[Papadustream] Fallback: E${prevEp} (target was E${targetEpisodes[0]})`);
        }
    }

    if (streams.length === 0) {
        console.log(`[Papadustream] No HLS for ${imdbId}${isTv ? ` S${targetSeason}E${targetEpisodes[0]}` : ''}`);
    } else {
        console.log(`[Papadustream] ${streams.length} stream(s) found`);
    }

    return streams;
}
