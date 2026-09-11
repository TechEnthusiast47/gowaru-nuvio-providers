export const SITE = {
  BASE_URL: 'https://streamzo.fr',
  DOMAIN: 'streamzo.fr',
  // Endpoint de suggestion du typeahead : renvoie l'href EXACT (film/série),
  // le kind, le titre, l'année et la qualité. Remplace la génération de slugs.
  SUGGEST_URL: 'https://streamzo.fr/api/web/suggest',
}

export const TIMEOUTS = {
  SUGGEST: 8000,
  SEARCH: 10000,
  PAGE: 12000,
  EMBED: 12000,
  RESOLVE: 15000,
  PROVIDER: 60000,
}

export const LIMITS = {
  // Nombre de requêtes /api/web/suggest (titres TMDB FR + VO)
  MAX_QUERIES: 3,
  // Slugs testés en dernier recours si l'API de suggestion ne répond pas
  MAX_SLUG_FALLBACK: 3,
  // Score minimal pour accepter une suggestion
  MIN_SUGGEST_SCORE: 45,
  // Variantes de langue résolues par épisode (VF puis VOSTFR)
  MAX_LANGS: 2,
}

export const SCORES = {
  MIN_MATCH: 30,
  EXACT_MATCH: 150,
  STRONG_MATCH: 100,
}
