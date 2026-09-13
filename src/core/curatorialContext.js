import path from 'node:path';
import {referenceIndex,resolveReference} from './curatorialPacket.js';

const label = value => String(value).replace(/[\[\]\r\n]/g,' ');
const targetValue = value => value.match(/^<([^>]+)>/)?.[1] || value.trim().split(/\s+/)[0];
const inline = /!?\[([^\]\n]*)\]\((<[^>\n]*>|[^)\n]+)\)/g;
function outsideFences(text, transform) {
  let fence;
  return text.split('\n').map(line=>{
    const match=line.match(/^\s*(`{3,}|~{3,})/);
    if(match){if(!fence)fence=match[1];else if(match[1][0]===fence[0]&&match[1].length>=fence.length)fence=undefined;return line;}
    return fence?line:transform(line);
  }).join('\n');
}
function rewrite(text, resolve) {
  return outsideFences(text,line=>line
    .replace(inline,(_,name,target)=>`[${name}](<${resolve(targetValue(target))}>)`)
    .replace(/^(\s*\[[^\]]+\]:\s*)(<[^>]+>|\S+)(.*)$/,(_,prefix,target,tail)=>`${prefix}<${resolve(targetValue(target))}>${tail}`)
    .replace(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi,(_,target)=>`[Image reference](<${resolve(target)}>)`)
    .replace(/\bhref=["']([^"']+)["']/gi,(_,target)=>`href="${resolve(target)}"`));
}
const urls = source => [...new Set(source.witnesses.flatMap(w=>w.urls||[]))].filter(url=>/^https?:\/\//.test(url));
const fencedText = body => {
  const fence='`'.repeat(Math.max(3,...[...body.matchAll(/`+/g)].map(m=>m[0].length+1)));
  return `${fence}text\n${body}\n${fence}\n`;
};

export function renderCuratorialContext({title,date,packetFingerprint,pages,catalog,sourceIds,supplements=[],scope='',canonicalPath='photo-select-context.md'}) {
  const byId=new Map(catalog.map(s=>[s.id,s]));
  const chosen=[...new Set(sourceIds)].map(id=>{
    const s=byId.get(id);if(!s||s.mode!=='exact'||typeof s.body!=='string')throw new Error('Selected source must supply a full textual source body');return s;
  });
  const included=new Set(chosen.map(s=>s.id));
  const sourceNumbers=new Map(chosen.map((s,i)=>[s.id,i+1]));
  const pageIds=new Map(pages.map((p,i)=>[p.path,`packet-page-${i+1}`]));
  const sourcePaths=new Map(catalog.flatMap(s=>[[s.reading,s.id],[s.path,s.id]]));
  const index=referenceIndex(catalog.flatMap(s=>s.witnesses));
  const references=new Map(),remoteSources=new Map();
  const sourceDestination=s=>{
    if(included.has(s.id))return `#context-source-${sourceNumbers.get(s.id)}`;
    if(!remoteSources.has(s.id))remoteSources.set(s.id,{id:`archive-source-${remoteSources.size+1}`,source:s});
    return '#'+remoteSources.get(s.id).id;
  };
  function reference(origin,target,result) {
    const key=result.matches?.length?JSON.stringify([result.state,result.matches,result.fragment||'']):origin+'\0'+target;
    if(!references.has(key))references.set(key,{id:`reference-${references.size+1}`,origins:new Map(),...result});
    references.get(key).origins.set(origin+'\0'+target,{origin,target});
    return '#'+references.get(key).id;
  }
  function destination(origin,target,result) {
    if(result.state==='external')return target;
    if(result.state==='matched'&&!result.fragment){
      const s=byId.get(result.matches[0]);
      return sourceDestination(s);
    }
    return reference(origin,target,result);
  }
  const coverage={included:chosen.length,notInlined:catalog.length-chosen.length,packetSourceObjects:catalog.length,supplementalSources:supplements.length,categories:{}};
  for(const s of catalog){const row=coverage.categories[s.category]??={included:0,notInlined:0};row[included.has(s.id)?'included':'notInlined']++;}
  let markdown=`---\nid: curatorial-context\ntitle: ${JSON.stringify(title)}\nkind: archival-context\nstatus: prepared-for-local-use\nvisibility: private\nsensitivity: high\nlast_reviewed: ${date}\ncanonical_path: ${JSON.stringify(canonicalPath)}\nsummary: Full selected archival texts and source-aware navigation for Photo Select\nrelations: []\n---\n\n# ${title}\n\n`;
  markdown+='This is archival context for the downstream curatorial team. Read the photographs independently. The source documents preserve earlier requests, editorial proposals, and interpretations as dated material; they do not prescribe photo choices, sequence, pacing, or an animation. Named source speakers and packet-preparation lenses are not additions to the configured curator roster.\n\n';
  markdown+=`Packet fingerprint: \`${packetFingerprint}\`. This is an explicit context projection of the packet: ${chosen.length} complete textual source representations are inlined once each; ${coverage.notInlined} source objects remain in the preservation directory. ${scope}\n\n`;
  markdown+='Selected bodies are not summarized or truncated. Inline navigation is adapted for this one file. Different source editions retain separate identities. Exact-original hashes and GitHub witnesses identify the source before navigation changes. Local paths appearing in source text describe custody; the API cannot open your local directories. External GitHub reading depends on the tools and authentication attached to the curation request.\n\n';
  markdown+='<a id="context-coverage"></a>\n## Coverage\n\n| Source family | Inlined | Remains in archive |\n| --- | ---: | ---: |\n';
  for(const [category,row] of Object.entries(coverage.categories).sort())markdown+=`| ${label(category)} | ${row.included} | ${row.notInlined} |\n`;
  const repos=[...new Set(catalog.flatMap(s=>urls(s).flatMap(url=>{const m=url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\//);return m?[m[1]]:[];})))].sort();
  if(repos.length)markdown+='\nRepositories represented by supplied witnesses; these links are discovery routes, not evidence of a fresh scan:\n\n'+repos.map(r=>`- [${r}](https://github.com/${r})`).join('\n')+'\n';
  if(supplements.length)markdown+='\n## Restored source material\n\nThese exact textual supplements were selected separately from the packet. They retain their own custody and dates. Source text is preserved inside code fences, including any quoted instructions.\n';
  for(const [i,s] of supplements.entries()){
    markdown+=`\n<a id="context-supplement-${i+1}"></a>\n### ${label(s.title)}\n\n${s.provenance}\n\nSource-file SHA-256: \`${s.sha256}\`. Excerpt SHA-256: \`${s.bodySha256}\`.\n\n<!-- source:${s.bodySha256} -->\n`;
    markdown+=fencedText(s.body)+`<!-- /source:${s.bodySha256} -->\n`;
  }
  markdown+='\n## Orientation from the packet\n';
  for(const p of pages){
    const resolve=target=>{
      if(/^https?:\/\//.test(target))return target;
      const [raw,fragment]=target.split('#');
      let local;try{local=path.posix.normalize(path.posix.join(path.posix.dirname(p.path),decodeURIComponent(raw||path.posix.basename(p.path))));}catch{return reference(p.path,target,{state:'unresolved',matches:[]});}
      if(pageIds.has(local))return '#'+pageIds.get(local);
      if(local==='wiki/CATALOG.md')return '#context-coverage';
      if(sourcePaths.has(local))return destination(p.path,target,{state:'matched',matches:[sourcePaths.get(local)],fragment});
      return reference(p.path,target,{state:'not-inlined',matches:[]});
    };
    markdown+=`\n<a id="${pageIds.get(p.path)}"></a>\n### ${label(p.path)}\n\n`+rewrite(p.text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/,''),resolve)+'\n';
  }
  markdown+='\n## Complete selected source documents\n\nThe order below groups source access; it is not a proposed photograph sequence.\n';
  for(const s of chosen){
    const origin=s.witnesses.find(w=>w.mode===s.mode)||s.witnesses[0];
    const resolve=target=>destination(s.id,target,resolveReference(origin,target,index));
    markdown+=`\n<a id="context-source-${sourceNumbers.get(s.id)}"></a>\n### S${sourceNumbers.get(s.id)} — ${label(s.title)}\n\nOriginal SHA-256: \`${s.id}\`. Source family: ${label(s.category)}.\n\n`;
    markdown+='Packet witnesses: '+s.witnesses.map(w=>`${w.packet}: \`${w.path}\``).join('; ')+'.\n\n';
    if(urls(s).length)markdown+='GitHub/source witnesses: '+urls(s).map((url,i)=>`[${i+1}](<${url}>)`).join(' · ')+'.\n\n';
    markdown+=`<!-- source:${s.id} -->\n`;
    if(/\.(json|jsonl|tsv|csv)$/i.test(s.path)){
      markdown+=fencedText(s.body);
    }else markdown+=rewrite(s.body,resolve)+'\n';
    markdown+=`<!-- /source:${s.id} -->\n`;
  }
  markdown+='\n## References requiring context or further access\n\nA reference here may identify an omitted source, an ambiguous edition, a requested section, or an unresolved original link. Its presence is not a claim that its body was read during curation.\n';
  for(const r of references.values()){
    markdown+=`\n<a id="${r.id}"></a>\n### ${r.id}\n\nState: ${r.state}.\n`;
    const targets=new Map();
    for(const {origin,target} of r.origins.values()){
      if(!targets.has(target))targets.set(target,[]);
      const n=sourceNumbers.get(origin);
      targets.get(target).push(n?`[S${n}](#context-source-${n})`:`\`${origin}\``);
    }
    for(const [target,origins] of targets)markdown+=`\nOriginal target: \`${target}\`. Origins: ${origins.join(', ')}.\n`;
    for(const id of r.matches){const s=byId.get(id);markdown+=`\n- [${label(s.title)}](${sourceDestination(s)})\n`;}
  }
  markdown+='\n## Referenced source bodies retained in the archive\n';
  for(const {id,source:s} of remoteSources.values()){
    markdown+=`\n<a id="${id}"></a>\n### ${label(s.title)}\n\nOriginal SHA-256: \`${s.id}\`. Body not inlined; archive storage: ${s.mode}.\n`;
    for(const url of urls(s))markdown+=`\n- [Source witness](<${url}>)\n`;
    if(!urls(s).length)markdown+='\nNo supplied remote URL witness; consult the original packet custody record.\n';
  }
  return {markdown,coverage,references:references.size};
}

export function checkContextLinks(markdown) {
  const lines=[];outsideFences(markdown,line=>{lines.push(line);return line;});
  const active=lines.join('\n'); // Quoted code cannot satisfy a navigation target.
  const anchors=new Set([...active.matchAll(/<a\s+id="([^"]+)"/g)].map(m=>m[1]));
  const errors=[];
  outsideFences(markdown,line=>{
    const destinations=[...[...line.matchAll(inline)].map(m=>targetValue(m[2])),...[...line.matchAll(/\bhref=["']([^"']+)["']/gi)].map(m=>m[1])];
    const definition=line.match(/^\s*\[[^\]]+\]:\s*(<[^>]+>|\S+)/);if(definition)destinations.push(targetValue(definition[1]));
    for(const target of destinations){if(/^https?:\/\//.test(target))continue;if(!target.startsWith('#')||!anchors.has(target.slice(1)))errors.push(`unavailable-link:${target}`);}
    return line;
  });
  return [...new Set(errors)];
}
