"use strict";
const { getLocalIzlelanJobs }=require("../providers/izlelan-adapter");
const targets=["Joyboy","Fujitora","Lili","Sabo","Law","Beckman"];
const anime=[["One Piece","37854",1,1],["Naruto","46260",1,1],["Attack on Titan","1429",1,1],["Demon Slayer","85937",1,1],["Jujutsu Kaisen","95479",1,1],["Death Note","13916",1,1]];
const nativeFetch=globalThis.fetch;
let current=null;
globalThis.fetch=async(...args)=>{let u=String(typeof args[0]==="string"?args[0]:args[0]?.url||"");try{const r=await nativeFetch(...args);if(current){current.requests++;if(r.status>=400){const host=(()=>{try{return new URL(u).hostname}catch{return "unknown"}})();current.http.push({status:r.status,host});}}return r}catch(e){if(current)current.networkErrors++;throw e}};
(async()=>{const jobs=getLocalIzlelanJobs().filter(x=>targets.includes(x.name));for(const job of jobs){const record={name:job.name,anime:[],requests:0,http:[],networkErrors:0};current=record;for(const [title,id,season,episode] of anime){let result={title,streams:0};try{const value=await Promise.race([Promise.resolve().then(()=>job.getStreams(id,"tv",season,episode)),new Promise((_,reject)=>setTimeout(()=>reject(new Error("timeout")),8000))]);result.streams=Array.isArray(value)?value.filter(x=>typeof x?.url==="string").length:0}catch(e){result.error=e.message?.slice(0,90)||"unknown"}record.anime.push(result)}current=null;console.log("ANIME_RESULT="+JSON.stringify(record))}})().catch(e=>{console.error(e);process.exitCode=1});
