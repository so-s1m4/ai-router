import assert from 'node:assert/strict';
import { test } from 'node:test';
import { automaticModels, modelTier, taskComplexity } from './model-routing.js';

test('Auto ranks economical models for simple tasks and stronger ones for complex work', () => {
  const models=['default','gpt-6-sol','gemini-flash','unknown','gpt-6-sol'].map(id=>({id,label:id}));
  assert.equal(taskComplexity('Переведи этот текст'), 'simple');
  assert.equal(taskComplexity('Реализуй миграцию базы данных'), 'complex');
  assert.equal(taskComplexity('Продолжай', 'Investigate the race condition'), 'complex');
  assert.deepEqual(automaticModels(models,[], 'simple'), ['gemini-flash','unknown','gpt-6-sol','default']);
  assert.deepEqual(automaticModels(models,['gpt-6-sol'], 'complex'), ['unknown','gemini-flash','default']);
  assert.equal(automaticModels(models,[], 'complex')[0], 'gpt-6-sol');
});

test('operator tier configuration overrides model name heuristics', () => {
  const cheap=process.env.AUTO_CHEAP_MODELS,strong=process.env.AUTO_STRONG_MODELS;
  try {
    process.env.AUTO_CHEAP_MODELS='custom-economy, gpt-6-sol';
    process.env.AUTO_STRONG_MODELS='custom-premium';
    assert.equal(modelTier('custom-economy'),'cheap');
    assert.equal(modelTier('gpt-6-sol'),'cheap');
    assert.equal(modelTier('custom-premium'),'strong');
  } finally {
    if(cheap===undefined)delete process.env.AUTO_CHEAP_MODELS;else process.env.AUTO_CHEAP_MODELS=cheap;
    if(strong===undefined)delete process.env.AUTO_STRONG_MODELS;else process.env.AUTO_STRONG_MODELS=strong;
  }
});
