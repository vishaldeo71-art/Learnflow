import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {translateUi,validUiLocale,uiDirection} from '../lib/i18n.ts';

const english=JSON.parse(fs.readFileSync(new URL('../public/locales/en.json',import.meta.url),'utf8'));
test('translation preserves inserted filenames, counts, and dynamic scorecard skills',()=>{
  const catalog={'Added {file} as {count} searchable passages.':'Ajout de {file} : {count} passages.','You connected answers to role-relevant skills: {skills}.':'Compétences : {skills}.'};
  assert.equal(translateUi(catalog,{key:'Added {file} as {count} searchable passages.',params:{file:'notes.pdf',count:7}}),'Ajout de notes.pdf : 7 passages.');
  assert.equal(translateUi(catalog,'You connected answers to role-relevant skills: Python, React.'),'Compétences : Python, React.');
});
test('untrusted locale values cannot become catalog paths and RTL uses explicit language metadata',()=>{
  for(const code of ['../../private','xx','auto',null])assert.equal(validUiLocale(code),'en');
  assert.equal(validUiLocale('fr'),'fr');
  for(const code of ['ar','he','fa','ur'])assert.equal(uiDirection(code),'rtl');
  assert.equal(uiDirection('fr'),'ltr');
});
test('rendered labels, placeholders, and status messages are represented in the source catalog',()=>{
  for(const filename of ['Assistant.tsx','LessonPlayer.tsx','LocalizedFileInput.tsx','I18nProvider.tsx','AccountForm.tsx','AdminPanel.tsx','StudyPanel.tsx','EvidenceSources.tsx','IntelligencePanel.tsx']){
    const source=fs.readFileSync(new URL('../components/'+filename,import.meta.url),'utf8');
    const ast=ts.createSourceFile(filename,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    function visit(node){
      if(ts.isJsxText(node)&&/[A-Za-z]/.test(node.text)&&node.text.trim()!=="A")assert.fail(`Untranslated JSX text in ${filename}: ${node.text.trim()}`);
      if(ts.isJsxAttribute(node)&&['placeholder','aria-label','title','alt'].includes(node.name.text)&&node.initializer&&ts.isStringLiteral(node.initializer))assert.fail(`Untranslated attribute in ${filename}: ${node.initializer.text}`);
      if(ts.isCallExpression(node)&&node.expression.getText(ast)==='t'&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0]))assert.ok(node.arguments[0].text in english,`Missing message ${node.arguments[0].text}`);
      ts.forEachChild(node,visit);
    }
    visit(ast);
  }
});

test('every installed interface catalog has all messages and preserves interpolation tokens',()=>{
  const languages=JSON.parse(fs.readFileSync(new URL('../lib/languages.json',import.meta.url),'utf8'));
  const keys=Object.keys(english).sort();
  for(const language of languages){
    const filename=new URL(`../public/locales/${language.code}.json`,import.meta.url);
    assert.ok(fs.existsSync(filename),`Missing ${language.code} catalog`);
    const catalog=JSON.parse(fs.readFileSync(filename,'utf8'));
    assert.deepEqual(Object.keys(catalog).sort(),keys,`Incomplete ${language.code}`);
    for(const key of keys){
      assert.ok(typeof catalog[key]==='string'&&catalog[key].trim(),`${language.code}: ${key}`);
      assert.deepEqual([...new Set(catalog[key].match(/\{\w+\}/g)||[])].sort(),[...new Set(key.match(/\{\w+\}/g)||[])].sort(),`${language.code}: changed placeholders in ${key}`);
    }
  }
});
