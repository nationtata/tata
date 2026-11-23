const { manifestVideoHeights } = require("../shared/playback-tracks");
const { sortStreamsByQuality } = require("../shared/quality.js");
const { loadConfig, val, wrapAll } = require("../shared/config.js");

var _cfgReady = null;
function cfgReady() {
    if (!_cfgReady) {
        _cfgReady = loadConfig().then(function () {
            var v;
            v = val('urls.movies.vidmody.base'); if (v && String(v).indexOf('vidmody.com') === -1) BASE_URL = String(v).replace(/\/+$/, '');
            if (STREAM_HEADERS) STREAM_HEADERS.Referer = BASE_URL + '/';
        });
    }
    return _cfgReady;
}

/**
 * Anthology - Vidmody Provider
 * Vidmody.com arşivi üzerinden doğrudan çift sesli (Türkçe & İngilizce)
 * ve Türkçe/İngilizce altyazılı 1080p HLS (.m3u8) akışları sunar.
 */

var PROVIDER_NAME = 'Vidmody';
var BASE_URL = 'https://ha.vixolity.com';
var TMDB_API_KEY  = (process.env.TMDB_API_KEY || "");

var VIXOLITY_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Referer': 'https://pl.vixolity.com/',
    'Origin': 'https://pl.vixolity.com',
    'Accept': '*/*'
};
var STREAM_HEADERS = VIXOLITY_HEADERS;

function parseVixolityTracks(playlist, playlistUrl, originalLanguage) {
    const subtitles = [];
    const audioTracks = [];
    for (const [, attributes] of playlist.matchAll(/^#EXT-X-MEDIA:([^\r\n]+)/gm)) {
        const fields = Object.fromEntries([...attributes.matchAll(/([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))/g)]
            .map(([, key, quoted, bare]) => [key, quoted ?? bare]));
        const lang = (fields.LANGUAGE || '').toLowerCase();
        const name = fields.NAME || lang;
        if (fields.TYPE === 'AUDIO') {
            const turkish = /^(?:tr(?:-tr)?|tur)$/.test(lang) || /^(?:türkçe|turkish)(?:\s|$)/iu.test(name);
            const original = Boolean(originalLanguage) && lang.split('-')[0] === originalLanguage;
            const dubbed = turkish && Boolean(originalLanguage) && originalLanguage !== 'tr';
            audioTracks.push({ lang: turkish ? 'tr' : lang, label: name, original, dubbed });
        }
        if (fields.TYPE === 'SUBTITLES' && fields.URI) {
            let url;
            try { url = new URL(fields.URI, playlistUrl); } catch { continue; }
            if (url.protocol !== 'https:' || url.username || url.password || subtitles.some(track => track.url === url.href)) continue;
            subtitles.push({
                id: lang, lang: lang === 'tr' ? 'tur' : lang === 'en' ? 'eng' : lang,
                language: lang, label: name, name, title: name, url: url.href,
                format: 'vtt', type: 'text/vtt', headers: VIXOLITY_HEADERS
            });
        }
    }
    return { subtitles, audioTracks, embeddedSubtitles: subtitles.length > 0, videoHeights: manifestVideoHeights(playlist) };
}

async function getStreams(tmdbId, mediaType, season, episode) {
    try {
        var id = tmdbId;
        var mType = mediaType;
        var sNum = parseInt(season) || 1;
        var eNum = parseInt(episode) || 1;

        if (typeof tmdbId === 'object' && tmdbId && tmdbId.id) {
            id = tmdbId.id;
            if (tmdbId.type) mType = tmdbId.type;
            if (tmdbId.season) sNum = parseInt(tmdbId.season) || 1;
            if (tmdbId.episode) eNum = parseInt(tmdbId.episode) || 1;
        }

        var cleanId = String(id || '').trim().replace(/^(?:movie|tv|series|tmdb|imdb):+/i, '');
        if (cleanId.includes(':')) cleanId = cleanId.split(':')[0];

        var isTV = (mType === 'tv' || mType === 'series');
        var typePath = isTV ? 'tv' : 'movie';
        var isImdb = cleanId.startsWith('tt');

        var imdbId = null;
        var displayTitle = 'İçerik';
        var releaseYear = '';
        var originalLanguage = '';

        if (isImdb) {
            imdbId = cleanId;
            var findUrl = 'https://api.themoviedb.org/3/find/' + cleanId + '?api_key=' + TMDB_API_KEY + '&external_source=imdb_id';
            var fRes = await fetch(findUrl);
            if (fRes.ok) {
                var fData = await fRes.json();
                var match = isTV ? (fData.tv_results && fData.tv_results[0]) : (fData.movie_results && fData.movie_results[0]);
                if (match) {
                    originalLanguage = match.original_language || '';
                    displayTitle = match.title || match.name || displayTitle;
                    releaseYear = (match.release_date || match.first_air_date || '').slice(0, 4);
                }
            }
        } else {
            var tmdbUrl = 'https://api.themoviedb.org/3/' + typePath + '/' + cleanId + '?api_key=' + TMDB_API_KEY + '&language=tr-TR&append_to_response=external_ids';
            var tmdbRes = await fetch(tmdbUrl);
            if (!tmdbRes.ok) return [];
            var d = await tmdbRes.json();
            imdbId = d.external_ids ? d.external_ids.imdb_id : (d.imdb_id || null);
            originalLanguage = d.original_language || '';
            displayTitle = d.title || d.name || displayTitle;
            releaseYear = (d.release_date || d.first_air_date || '').slice(0, 4);
        }

        if (!imdbId || !imdbId.startsWith('tt')) return [];

        var targetUrl = '';

        if (!isTV) {
            targetUrl = 'https://ha.vixolity.com/vs/' + imdbId;
            if (releaseYear) displayTitle += ' (' + releaseYear + ')';
        } else {
            var sStr = 's' + sNum;
            var eStr = 'e' + (eNum < 10 ? '0' + eNum : eNum);
            targetUrl = 'https://ha.vixolity.com/vs/' + imdbId + '/' + sStr + '/' + eStr;
            displayTitle += ' - S' + String(sNum).padStart(2, '0') + 'E' + String(eNum).padStart(2, '0');
        }

        try {
            var checkRes = await fetch(targetUrl, {
                headers: VIXOLITY_HEADERS
            });

            if (checkRes.ok) {
                var text = await checkRes.text();
                if (text.includes('#EXTM3U')) {
                    var tracks = parseVixolityTracks(text, targetUrl, originalLanguage);
                    return [{
                        name: 'Vidmody',
                        title: displayTitle,
                        ...(tracks.audioTracks.some(track => track.original) && { audioLabel: 'Orijinal' }),
                        url: targetUrl,
                        quality: '1080p',
                        headers: VIXOLITY_HEADERS,
                        format: 'hls',
                        isHls: true,
                        behaviorHints: {
                            notWebReady: true,
                            proxyHeaders: { request: VIXOLITY_HEADERS }
                        },
                        provider: 'vidmody',
                        ...tracks
                    }];
                }
            }
        } catch (linkErr) {
            return [];
        }

        return [];
    } catch (e) {
        console.error('[Vidmody] Hata:', e.message);
        return [];
    }
}

// ── Universal Quality Sorter ──────────────────────────────────────────
if (typeof getStreams === "function") {
    var _origGetStreams = getStreams;
    getStreams = async function() {
        var res = await _origGetStreams.apply(this, arguments);
        return sortStreamsByQuality(res);
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = wrapAll({ getStreams: getStreams }, cfgReady);
} else {
    global.VidmodyProvider = { getStreams: getStreams };
}
