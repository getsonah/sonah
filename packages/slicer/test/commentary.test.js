import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildEvents } from '../src/events.js';
import { sliceLineage } from '../index.js';
import { redact,sliceHash } from '../../redact/index.js';
import { visibleContentBlocks } from '../src/codex.js';

const msg=(type,content)=>({type,message:{content}});
const say=text=>({type:'text',text});
const write=path=>({type:'tool_use',id:path,name:'Write',input:{file_path:path,content:'const n = 2;'}});
const capture=rows=>{const b=buildEvents(rows.map((raw,i)=>({kind:raw.type,raw,line:i+1,source:0})),{cwd:'/repo'});
  return {...b,ledger:b.events,dropped:[]};};

test('production retains every visible block and its intra-message action position',()=>{
  const l=capture([msg('user','Choose a mechanism.'),msg('assistant',[say(' Try A. '),write('/repo/a.js'),say(' Switch to B. '),write('/repo/b.js')]),msg('assistant','Done.')]);
  assert.deepEqual(l.commentary.map(s=>s.text),[' Try A. ',' Switch to B. ','Done.']);
  assert.deepEqual(l.commentary.map(s=>[s.record,s.block,s.beforeEvent]),[[2,0,0],[2,2,1],[3,0,2]]);
  // C-01 event identity: the closing statement is its row's (`final`); these rows record no uuid, so it is counted.
  assert.deepEqual(l.sayings,[{turn:1,text:'Done.',identity:{stream:0,record:3,unidentified:true,sub:'final'}}]);
  assert.equal(l.commentaryCapture.blocks,3);
});
test('long commentary is not clipped and private/unsupported blocks are distinguished',()=>{
  const text=' A complete visible statement.\n'.repeat(1000);
  const l=capture([msg('assistant',[say(text),{type:'thinking',thinking:'PRIVATE'},
    {type:'image',source:{data:'IMAGE_PRIVATE'}},{type:'future_format'}]),{...msg('assistant','ANALYSIS_PRIVATE'),channel:'analysis'}]);
  assert.equal(l.commentary[0].text,text);assert.equal(l.commentaryCapture.privateExcluded,2);
  assert.equal(l.commentaryCapture.unsupported,1);assert.ok(!JSON.stringify(l).includes('PRIVATE'));
  assert.equal(l.commentaryCapture.nonTextExcluded,1);
});
test('commentary participates in cache identity including recursive child units (D90: as recorded)',()=>{
  const token='ghp_'+'a'.repeat(36);
  const raw=capture([msg('assistant',token),msg('assistant','Same ending')]);
  const clean=redact(raw).ledger;
  assert.equal(clean.commentary[0].text,token);
  const changed=structuredClone(clean);changed.commentary[0].text='A different assumption';
  assert.notEqual(sliceHash(clean),sliceHash(changed));
  const parent={ask:[],ledger:[],claim:{},children:[{source:1,ledger:raw}]};
  assert.equal(redact(parent).ledger.children[0].ledger.commentary[0].text,token);
  const a=redact(parent).ledger,b=structuredClone(a);b.children[0].ledger.commentary[0].text='Different child assumption';
  assert.notEqual(sliceHash(a),sliceHash(b));
});
test('Codex message blocks preserve whitespace and exclude private fields instead of flattening them',()=>{
  const blocks=visibleContentBlocks([{type:'output_text',text:' first '},{type:'reasoning',text:'PRIVATE'},{type:'output_text',text:' second '}]);
  assert.deepEqual(blocks,[say(' first '),{type:'reasoning'},say(' second ')]);
  assert.deepEqual(visibleContentBlocks('  plain  '),[say('  plain  ')]);
  assert.equal(visibleContentBlocks("[{'type':'input_text','text':'legacy'}]")[0].text,'legacy');
  assert.equal(visibleContentBlocks("[{'type':'reasoning','text':'PRIVATE'}]")[0].type,'unsupported_content');
});
test('read/slice pipeline preserves Codex visible channels and locators across lineage files',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'sonah-commentary-'));
  try{
    const file=join(dir,'rollout-2026-09-13T10-00-00-case.jsonl');
    const rows=[{type:'session_meta',payload:{id:'fixture',cwd:'/repo'}},
      {type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'Choose.'}]}},
      ...['commentary','analysis','final'].map(channel=>({type:'response_item',payload:{type:'message',role:'assistant',channel,
        content:[{type:'output_text',text:channel==='analysis'?'PRIVATE':channel}]}}))];
    await writeFile(file,rows.map(JSON.stringify).join('\n'));
    const l=await sliceLineage([file]);
    assert.deepEqual(l.commentary.map(s=>s.text),['commentary','final']);
    assert.deepEqual(l.commentary.map(s=>s.record),[3,5]);assert.ok(!JSON.stringify(l).includes('PRIVATE'));
    const other=join(dir,'other.jsonl');await writeFile(other,JSON.stringify(msg('assistant','after compaction')));
    const joined=await sliceLineage([file,other]);assert.equal(joined.commentary.at(-1).source,1);
  }finally{await rm(dir,{recursive:true,force:true});}
});
