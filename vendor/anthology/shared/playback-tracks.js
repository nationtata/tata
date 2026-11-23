function manifestVideoHeights(master) {
    const heights = [...String(master || '').matchAll(/^#EXT-X-STREAM-INF:(?:[^\r\n]*,)?RESOLUTION=\d+x(\d+)(?:,|\r?$)/gmi)]
        .map(([, height]) => Number(height));
    return [...new Set(heights)];
}

function playbackTracks(master, declaredAudio) {
    const renditions = [...String(master || '').matchAll(/^#EXT-X-MEDIA:([^\r\n]+)/gm)].map(([, line]) =>
        Object.fromEntries([...line.matchAll(/([A-Z0-9-]+)=(?:"([^"]*)"|([^,]+))/g)]
            .map(([, key, quoted, plain]) => [key, quoted ?? plain]))
    );
    const hlsAudio = renditions.filter(track => track.TYPE === 'AUDIO')
        .map(track => ({ lang: track.LANGUAGE, label: track.NAME }));
    const tracks = [...hlsAudio, ...(Array.isArray(declaredAudio) ? declaredAudio : [])].filter(Boolean).map(track => {
        const label = String(track.label || track.name || '');
        const language = String(track.lang || track.language || '').toLowerCase();
        const turkish = /^(?:tr(?:-tr)?|tur)$/.test(language) || /türkçe|turkce|turkish/i.test(label);
        return {
            lang: turkish ? 'tr' : language,
            label,
            dub: turkish && (track.dubbed === true || /dublaj|dubbed|\bdub\b/i.test(label)),
            original: /orijinal|original/i.test(label)
        };
    });
    return {
        videoHeights: manifestVideoHeights(master),
        embeddedSubtitles: renditions.some(track => track.TYPE === 'SUBTITLES'),
        audioTracks: tracks.map(track => ({
            lang: track.lang, label: track.label, original: track.original,
            dubbed: track.dub
        }))
    };
}

module.exports = { playbackTracks, manifestVideoHeights };
