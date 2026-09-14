import {it,expect} from 'vitest';
import {renderCuratorialContext,checkContextLinks} from '../src/core/curatorialContext.js';
const a='a'.repeat(64), b='b'.repeat(64), c='c'.repeat(64);
const source=(id,name,body,extra={})=>({id,title:name,path:`artifacts/exact/${id}/${name}`,reading:`wiki/sources/${id}.md`,mode:'exact',category:'archival-readings',body,witnesses:[{packet:'A',path:name,sha256:id,mode:'exact',logicalPaths:[name]}],...extra});
function fixture(){return {title:'Synthetic context',date:'2026-09-13',packetFingerprint:'d'.repeat(64),pages:[{path:'START-HERE.md',text:`# Guide\n[Account](wiki/sources/${a}.md)`}],catalog:[source(a,'one.md','# Account\nFirst account, with uncertainty.\n[Other](two.md)'),source(b,'two.md','# Another account\nDifferent testimony survives.')],sourceIds:[a,b]};}
it('embeds complete distinct source editions once despite repeated selections',()=>{
 const input=fixture();input.sourceIds.push(a);const {markdown}=renderCuratorialContext(input);
 expect(markdown.match(/First account, with uncertainty\./g)).toHaveLength(1);
 expect(markdown).toContain('Different testimony survives.');expect(markdown).toContain(a);expect(markdown).toContain(b);
});
it('replaces local directory navigation with working in-document anchors',()=>{
 const {markdown}=renderCuratorialContext(fixture());expect(markdown).not.toContain('](two.md)');expect(markdown).not.toContain('](wiki/sources/');
 expect(markdown).toContain('Different testimony survives.');expect(checkContextLinks(markdown)).toEqual([]);
});
it('keeps pinned GitHub access for a referenced source whose body is not inlined',()=>{
 const input=fixture();input.sourceIds=[a];input.catalog[1].witnesses[0].urls=['https://github.com/example/archive/blob/abc/two.md'];
 const {markdown,coverage}=renderCuratorialContext(input);
 expect(markdown).toContain('https://github.com/example/archive/blob/abc/two.md');expect(markdown).not.toContain('Different testimony survives.');
 expect(coverage.included).toBe(1);expect(coverage.notInlined).toBe(1);expect(checkContextLinks(markdown)).toEqual([]);
});
it('keeps ambiguity visible instead of choosing one of two editions',()=>{
 const input=fixture();input.catalog.push(source(c,'copy.md','Competing account',{witnesses:[{packet:'A',path:'copy.md',sha256:c,mode:'exact',logicalPaths:['two.md']}]}));
 input.catalog[1].witnesses[0].path='relocated/two.md';
 const {markdown}=renderCuratorialContext(input);expect(markdown).toContain('ambiguous');expect(checkContextLinks(markdown)).toEqual([]);
});
it('handles reference-style Markdown and HTML links without remote filesystem assumptions',()=>{
 const input=fixture();input.catalog[0].body='[Account][next]\n\n[next]: two.md\n\n<a href="two.md">Also</a>\n\n![Scan](scan.jpg)';
 const {markdown}=renderCuratorialContext(input);expect(markdown).not.toContain('href="two.md"');expect(markdown).not.toContain('[next]: two.md');expect(markdown).not.toContain('![Scan]');expect(markdown).toContain('[Scan]');expect(checkContextLinks(markdown)).toEqual([]);
});
it('leaves quoted code examples intact while converting active navigation',()=>{
 const input=fixture();input.catalog[0].body='```md\n[Example](not-an-active-link.md)\n```\n[Other](two.md)';
 const {markdown}=renderCuratorialContext(input);expect(markdown).toContain('[Example](not-an-active-link.md)');expect(markdown).not.toContain('](two.md)');expect(checkContextLinks(markdown)).toEqual([]);
});
it('refuses to pretend a media pointer supplies a full textual source',()=>{
 const input=fixture();input.catalog[0].mode='pointer';expect(()=>renderCuratorialContext(input)).toThrow(/textual source/);
});
it('detects dangling anchors and local links in a completed export',()=>{
 expect(checkContextLinks('[Missing](#absent)\n[Local](../notes.md)').length).toBe(2);
});
it('does not accept an anchor that exists only inside a quoted code example',()=>{
 expect(checkContextLinks('```html\n<a id="quoted"></a>\n```\n[Missing](#quoted)')).toContain('unavailable-link:#quoted');
});
it('shares one remote source definition across repeated references without removing source bodies',()=>{
 const input=fixture();input.catalog.push(source(c,'three.md','A third account.\n[Other again](two.md)'));input.sourceIds=[a,c];
 const url='https://github.com/example/archive/blob/abc/two.md';input.catalog[1].witnesses[0].urls=[url];
 const {markdown}=renderCuratorialContext(input);
 expect(markdown.split(url)).toHaveLength(2);expect(markdown).toContain('First account, with uncertainty.');expect(markdown).toContain('A third account.');expect(checkContextLinks(markdown)).toEqual([]);
});
it('uses short source anchors while retaining the full identity and body of each edition',()=>{
 const {markdown}=renderCuratorialContext(fixture());
 expect(markdown).toContain('[Other](<#context-source-2>)');
 expect(markdown).toContain('id="context-source-2"');
 expect(markdown).toContain(`Original SHA-256: \`${b}\``);
 expect(markdown).toContain('Different testimony survives.');expect(checkContextLinks(markdown)).toEqual([]);
});
it('groups repeated reference targets without losing the association to either source',()=>{
 const input=fixture();input.catalog[0].body='First account.\n[Section](two.md#section)';
 input.catalog.push(source(c,'three.md','Third account.\n[Section again](two.md#section)'));input.sourceIds.push(c);
 const {markdown}=renderCuratorialContext(input);const appendix=markdown.slice(markdown.indexOf('## References requiring'));
 expect(appendix.split('`two.md#section`')).toHaveLength(2);
 expect(appendix).toContain('[S1](#context-source-1)');expect(appendix).toContain('[S3](#context-source-3)');
 expect(markdown).toContain('First account.');expect(markdown).toContain('Third account.');expect(checkContextLinks(markdown)).toEqual([]);
});
it('preserves supplemental correspondence exactly, including quoted Markdown and non-ASCII text',()=>{
 const input=fixture();const body='From: Writer\r\nNo rush — please keep both requests separate.\r\n```\r\n[Quoted link](local.md)\r\n```\r\n';
 input.supplements=[{title:'Complete conversation',body,bodySha256:c,sha256:'e'.repeat(64),provenance:'Exact excerpt from the previous context.'}];
 const {markdown,coverage}=renderCuratorialContext(input);
 expect(markdown).toContain(body);expect(markdown.indexOf(body)).toBeLessThan(markdown.indexOf('## Orientation'));
 expect(markdown).toContain(`<!-- source:${c} -->`);expect(markdown).toContain('Exact excerpt from the previous context.');
 expect(coverage.supplementalSources).toBe(1);expect(checkContextLinks(markdown)).toEqual([]);
});
