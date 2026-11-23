"use strict";
const { getLocalIzlelanJobs } = require("../providers/izlelan-adapter");
const nativeFetch = globalThis.fetch;
let active = null;
globalThis.fetch = async (...args) => {
  const url = String(typeof args[0] === "string" ? args[0] : args[0]?.url || "");
  try {
    const response = await nativeFetch(...args);
    if (active) {
      active.requests++;
      if (response.status === 403) active.http403++;
      if (response.status === 404) active.http404++;
      if (response.status >= 500) active.http5xx++;
      if (response.status >= 400 && active.errors.length < 4) active.errors.push({status:response.status,host:(()=>{try{return new URL(url).hostname}catch{return "unknown"}})()});
    }
    return response;
  } catch(e) {
    if (active) { active.networkErrors++; if(active.errors.length<4)active.errors.push({network:e.name||"Error"}); }
    throw e;
  }
};
(async () => {
  const jobs=getLocalIzlelanJobs();
  const results=[];
  for(const {name,getStreams} of jobs){
    const data={name,requests:0,http403:0,http404:0,http5xx:0,networkErrors:0,errors:[],movie:0,series:0,timeout:false};
    active=data;
    for(const [kind,id,media,season,episode] of [["movie","603","movie",undefined,undefined],["series","1399","tv",1,1]]){
      try {
        const value=await Promise.race([
          Promise.resolve().then(()=>getStreams(id,media,season,episode)),
          new Promise((_,reject)=>setTimeout(()=>reject(new Error("probe-timeout")),10000))
        ]);
        data[kind]=Array.isArray(value)?value.filter(x=>typeof x?.url==="string").length:0;
      }catch(e){if(e.message==="probe-timeout")data.timeout=true;else data.errors.push({exception:String(e.message||e).slice(0,120)});}
    }
    active=null;
    results.push(data);
    console.log("PROVIDER_RESULT="+JSON.stringify(data));
  }
  console.log("PROVIDER_SUMMARY="+JSON.stringify(results));
})().catch(e=>{console.error(e);process.exitCode=1;});
