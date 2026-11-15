const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','maskkan-demo','index.html'),'utf8');

test('مسّكن: inline browser scripts parse successfully',()=>{
 const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(x=>x[1]);
 assert.ok(scripts.length>0,'Missing browser scripts');
 scripts.forEach((script,index)=>assert.doesNotThrow(()=>new vm.Script(script,{filename:'maskkan-inline-'+index+'.js'})));
});

test('مسّكن: essential mobile listing controls exist',()=>{
 for(const pattern of [
   'dir="rtl"','name="viewport"','id="mkAuthForm"','id="mkAddForm"',
   'id="mkPhotos"','type="file"','id="mkMine"',
   'mkPrepareImage','mkUploadPhotos','/api/maskkan/properties'
 ]) assert.ok(html.includes(pattern), 'Missing: '+pattern);
});

test('مسّكن: listing form includes rental and sale modes',()=>{
 assert.match(html,/<option value="rent">للإيجار<\/option>/);
 assert.match(html,/<option value="sale">للبيع<\/option>/);
});
