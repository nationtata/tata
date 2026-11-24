// Pilot: index public, embeddable full episodes from the supplied Ezel channel.
const fs = require("node:fs/promises");
const key = process.env.YOUTUBE_DATA_API_KEY;
async function api(resource, params) {
  if (!key) throw new Error("YOUTUBE_DATA_API_KEY missing");
  const res = await fetch("https://www.googleapis.com/youtube/v3/"+resource+"?"+new URLSearchParams(params), {headers:{"X-Goog-Api-Key":key},signal:AbortSignal.timeout(15000)});
  if (!res.ok) throw new Error(resource+" HTTP "+res.status);
  return res.json();
}
async function main(){
  const channels=await api("channels",{part:"snippet,contentDetails",forHandle:"@ezel"});
  const channel=channels.items?.[0];
  if(!channel) throw new Error("Channel not found");
  const playlistId=channel.contentDetails.relatedPlaylists.uploads;
  const episodes=[];
  let pageToken;
  do {
    const page=await api("playlistItems",{part:"contentDetails",playlistId,maxResults:"50",...(pageToken?{pageToken}:{})});
    const ids=(page.items||[]).map(x=>x.contentDetails.videoId);
    if(ids.length){
      const videos=await api("videos",{part:"snippet,status,contentDetails",id:ids.join(",")});
      for(const v of videos.items||[]){
        const title=v.snippet.title.normalize("NFKD").replace(/\p{M}/gu,"").toLowerCase().replace(/ı/g,"i");
        const match=title.match(/^ezel\s*[-:–]?\s*(\d+)\.?\s*bolum(?:\s*[-|–]?\s*(?:full hd|tek parca|tam bolum|hd))?\s*$/);
        const duration=v.contentDetails.duration.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
        const region=v.contentDetails.regionRestriction;
        if(!match||!duration||Number(duration[1]||0)*60+Number(duration[2]||0)<40||v.status.privacyStatus!=="public"||!v.status.embeddable||v.snippet.channelId!==channel.id||region?.blocked?.includes("TR")||(region?.allowed&&!region.allowed.includes("TR"))) continue;
        episodes.push({absoluteEpisode:Number(match[1]),ytId:v.id,title:v.snippet.title,season:null,episode:null});
      }
    }
    pageToken=page.nextPageToken;
  }while(pageToken);
  await fs.writeFile("data/youtube/ezel-index.json",JSON.stringify({channelId:channel.id,channelTitle:channel.snippet.title,handle:"@ezel",imdbId:"tt1534360",status:"pending_channel_and_season_review",episodes:episodes.sort((a,b)=>a.absoluteEpisode-b.absoluteEpisode)},null,2)+"\n");
  console.log("Indexed "+episodes.length+" candidate full episodes");
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
