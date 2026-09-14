#!/usr/bin/env node
import {createInterface} from 'node:readline';
import {createGithubBridge} from '../src/githubBridge.js';
const bridge=createGithubBridge();
const input=createInterface({input:process.stdin,crlfDelay:Infinity});
const write=value=>{if(value!==undefined)process.stdout.write(JSON.stringify(value)+'\n');};
input.on('line',line=>{
  if(line.length>1024*1024){write({jsonrpc:'2.0',id:null,error:{code:-32600,message:'MCP input exceeds limit.'}});return;}
  let message;
  try{message=JSON.parse(line);}catch{write({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid JSON.'}});return;}
  void bridge(message).then(write,()=>write({jsonrpc:'2.0',id:null,error:{code:-32603,message:'MCP request failed.'}}));
});
