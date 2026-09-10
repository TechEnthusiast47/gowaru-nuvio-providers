import { extractStreams } from './extractor.js';
import { createProvider, createSettingsLayout } from '../utils/resolvers.js';

module.exports = {
    getStreams: createProvider('Frenchstream', extractStreams),
    // UI de réglages — NuvioMobile uniquement (NuvioTV ignore le hook mais
    // injecte quand même SCRAPER_SETTINGS si sauvegardés ailleurs).
    // Schéma vérifié dans PluginSettingsDialog.kt :
    //   header/info/text/select(options[{label,value}], defaultValue)/toggle(defaultValue)
    onSettings: createSettingsLayout([
        { type: 'header', label: 'Préférences FrenchStream' },
        {
            type: 'select',
            key: 'language',
            label: 'Langue préférée',
            description: "Ne résout que les sources de la langue choisie quand c'est possible",
            defaultValue: 'all',
            options: [
                { label: 'Tout (VF + VOSTFR)', value: 'all' },
                { label: "VF d'abord (filtre VOSTFR)", value: 'vf' },
                { label: 'VOSTFR d\'abord (filtre VF)', value: 'vostfr' },
            ],
        },
        {
            type: 'text',
            key: 'excludeHosts',
            label: 'Hosts exclus',
            description: "Noms séparés par des virgules, ex: dood, streamtape, fsvid. Laisser vide pour tout garder.",
            placeholder: 'dood, streamtape',
        },
        { type: 'info', label: "Astuce : exclure un host accélère la résolution (moins de timeouts)." },
    ]),
};
