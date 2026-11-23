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
    const otherAudio = tracks.some(track => track.lang !== 'tr' && (track.lang || track.original));
    return {
        embeddedSubtitles: renditions.some(track => track.TYPE === 'SUBTITLES'),
        audioTracks: tracks.map(track => ({
            lang: track.lang, label: track.label,
            dubbed: track.lang === 'tr' && (track.dub || otherAudio && !track.original)
        }))
    };
}

module.exports = { playbackTracks };
