import { extractStreams } from './extractor.js';
import { createProvider, createSettingsLayout } from '../utils/resolvers.js';

module.exports = {
    getStreams: createProvider('Movix', extractStreams),
    // UI de réglages — NuvioMobile uniquement (NuvioTV ignore le hook mais
    // injecte quand même SCRAPER_SETTINGS si sauvegardés ailleurs)
    onSettings: createSettingsLayout([
        { type: 'header', label: 'Préférences Movix' },
        {
            type: 'select',
            key: 'language',
            label: 'Langue préférée',
            description: "Filtre les sources par langue quand c'est possible",
            defaultValue: 'all',
            options: [
                { label: 'Tout (VF + VOSTFR)', value: 'all' },
                { label: "VF d'abord (filtre VOSTFR)", value: 'vf' },
                { label: "VOSTFR d'abord", value: 'vostfr' },
            ],
        },
        {
            type: 'toggle',
            key: 'skipSlowHosts',
            label: 'Ignorer les hosts lents',
            description: 'Exclut les hosts connus pour être lents ou dead (dood, streamtape…)',
            defaultValue: false,
        },
    ]),
};
