import test from "node:test";
import assert from "node:assert/strict";
import { fold, gameSearchTexts, score, scoreFolded } from "../src/search.ts";

test("片假名查询匹配平假名标题", () => {
  assert.equal(fold("ミルフェリア"), "みるふぇりあ");
  assert.equal(score("ミルフェリア", ["みるふぇりあ"]), 100);
});

test("平假名查询匹配片假名标题", () => {
  assert.equal(score("みるふぇりあ", ["ミルフェリア"]), 100);
});

test("fold 统一全角半角、大小写、空格和标点", () => {
  assert.equal(fold("  Ｍｉｒａ'ｓ  "), "miras");
  assert.equal(fold("【Ｍｉｒａ'ｓ： Ｇａｒｄｅｎ！】"), "mirasgarden");
});

test("全角英文查询匹配 Mira's Garden", () => {
  assert.equal(score("ｍｉｒａ's", ["Mira's Garden"]), 100);
});

test("中文名包含匹配", () => {
  assert.equal(score("璃娜雅", ["霜月少女星环璃娜雅"]), 90);
});

test("少打几个字仍可按顺序匹配", () => {
  // 当前实现根据匹配间距调整分数；这里验证匹配成立且优于拼写容错。
  const result = score("霜星璃", ["霜月少女星环璃娜雅"]);
  assert.ok(result > 40 && result <= 60);
});

test("Velmorni 拼写错误仍匹配 Velmorin", () => {
  assert.ok(score("Velmorni", ["Velmorin"]) > 0);
});

test("Mirefonia 拼写错误仍匹配 Magical Girl Mirephonia", () => {
  assert.ok(score("Mirefonia", ["Magical Girl Mirephonia"]) > 0);
});

test("无关查询 xyz 不匹配 Velmorin", () => {
  assert.equal(score("xyz", ["Velmorin"]), 0);
});

test("单个无关字母 q 不匹配", () => {
  assert.equal(score("q", ["Velmorin", "Magical Girl Mirephonia"]), 0);
});

test("空搜索词返回 1", () => {
  assert.equal(score("", ["Velmorin"]), 1);
  assert.equal(score("", []), 1);
  assert.equal(score("  ！ ", ["Velmorin"]), 1);
});

test("开头匹配比包含匹配分数高", () => {
  const prefix = score("Velmorin", ["Velmorin Adventure"]);
  const contains = score("Velmorin", ["The Velmorin Adventure"]);
  assert.equal(prefix, 100);
  assert.equal(contains, 90);
  assert.ok(prefix > contains);
});

test("主搜索：别名和俗称也能搜到作品", () => {
  const g = { id: "RJ1", title: "優艶の花", names: { ja: "優艶の花", zh: "", en: "" }, aliases: ["Yuen-Zoku"], aka: ["小明的冒险"], circle: "" };
  const hit = q => scoreFolded(fold(q), gameSearchTexts(g));
  assert.equal(hit("yuenzoku"), 100);
  assert.equal(hit("小明的冒险"), 100);
  assert.equal(hit("完全无关的词"), 0);
  // 没有别名、俗称的作品照旧
  assert.equal(scoreFolded(fold("yuenzoku"), gameSearchTexts({ ...g, aliases: undefined, aka: undefined })), 0);
});
