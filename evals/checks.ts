import { reaisToCents } from '@garfo/shared';
import {
  type ArgCondition,
  type EvalCase,
  type RecommendedDishesSatisfy,
  type ToolArgsExpectation,
} from './schema';

/** A dish as the database knows it: the source of truth for every "satisfy" check. */
export interface DishFacts {
  id: string;
  name: string;
  priceCents: number;
  dietaryTags: string[];
  allergens: string[];
  category: string;
  available: boolean;
  restaurantOpen: boolean;
  deliveryMaxMinutes: number;
}

export interface ObservedToolCall {
  name: string;
  /** Parsed `argsJson`; `undefined` when the model produced invalid JSON. */
  args: unknown;
}

/** Everything the harness learned from running one case. Checks are pure functions of it. */
export interface Observation {
  toolCalls: ObservedToolCall[];
  /** Distinct card ids shown in each assistant reply (one entry per user message). */
  cardIdsPerReply: string[][];
  /** Dishes behind those ids, from the database. Ids missing here do not exist in the catalog. */
  dishes: ReadonlyMap<string, DishFacts>;
  /** Final cart, as (dish name, quantity) pairs. */
  cartItems: Array<{ dishName: string; quantity: number }>;
  /** Restaurant id of each cart item, captured after every user turn (one entry per turn). */
  cartRestaurantIdsPerTurn: string[][];
  /** Text of every assistant message of the last turn, joined, with `[[dish:id]]` markers still in it. */
  finalReplyText: string;
  /** `[[dish:id]]` markers written by the model that no tool result of the conversation held. */
  hallucinatedIds: string[];
  /** Messages of `error` events or exceptions: a run with any of these cannot pass. */
  runErrors: string[];
}

export interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

export interface CaseOutcome {
  passed: boolean;
  checks: CheckResult[];
}

/**
 * A run that ended because the provider was overloaded or rate limited (LLM_OVERLOADED, or a raw
 * 429/503) says nothing about the agent: it is classified as infrastructure, not as a failure.
 */
export function isInfrastructureFailure(runErrors: string[]): boolean {
  return runErrors.some((error) => /^LLM_OVERLOADED\b/.test(error) || /\b(429|503)\b/.test(error));
}

const reais = (cents: number): string => `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;

export function evaluateCase(evalCase: EvalCase, observation: Observation): CaseOutcome {
  const { expect } = evalCase;
  const checks: CheckResult[] = [];

  checks.push({
    name: 'completed',
    passed: observation.runErrors.length === 0,
    detail:
      observation.runErrors.length === 0
        ? 'no error events'
        : `error: ${observation.runErrors.join('; ')}`,
  });

  const called = new Set(observation.toolCalls.map((c) => c.name));
  const calledText = called.size > 0 ? [...called].join(', ') : 'none';

  for (const tool of expect.mustCallTools ?? []) {
    checks.push({
      name: `mustCall:${tool}`,
      passed: called.has(tool),
      detail: called.has(tool) ? 'called' : `not called (called: ${calledText})`,
    });
  }
  for (const tool of expect.mustNotCallTools ?? []) {
    checks.push({
      name: `mustNotCall:${tool}`,
      passed: !called.has(tool),
      detail: called.has(tool) ? 'was called' : 'not called',
    });
  }

  for (const [tool, min] of Object.entries(expect.minToolCalls ?? {})) {
    const count = observation.toolCalls.filter((c) => c.name === tool).length;
    checks.push({
      name: `minToolCalls:${tool}`,
      passed: count >= min,
      detail: `${tool} called ${count} time(s), expected at least ${min}`,
    });
  }

  for (const expectation of expect.toolArgs ?? []) {
    checks.push(checkToolArgs(expectation, observation.toolCalls));
  }

  const allCardIds = [...new Set(observation.cardIdsPerReply.flat())];
  if (expect.minRecommendations !== undefined) {
    checks.push({
      name: 'minRecommendations',
      passed: allCardIds.length >= expect.minRecommendations,
      detail: `${allCardIds.length} dish(es) recommended, expected at least ${expect.minRecommendations}`,
    });
  }
  if (expect.maxRecommendations !== undefined) {
    const max = Math.max(0, ...observation.cardIdsPerReply.map((ids) => ids.length));
    checks.push({
      name: 'maxRecommendations',
      passed: max <= expect.maxRecommendations,
      detail: `at most ${max} card(s) in a single reply, limit ${expect.maxRecommendations}`,
    });
  }
  if (expect.recommendedDishesSatisfy) {
    checks.push(checkRecommended(expect.recommendedDishesSatisfy, allCardIds, observation.dishes));
  }
  if (expect.cartAfter) checks.push(checkCart(expect.cartAfter, observation.cartItems));
  if (expect.noHallucinatedDishes) {
    checks.push({
      name: 'noHallucinatedDishes',
      passed: observation.hallucinatedIds.length === 0,
      detail:
        observation.hallucinatedIds.length === 0
          ? 'every cited dish came from a tool'
          : `unknown ids cited: ${observation.hallucinatedIds.join(', ')}`,
    });
  }

  if (expect.cartNeverMixesRestaurants) {
    checks.push(checkCartNeverMixes(observation.cartRestaurantIdsPerTurn));
  }
  if (expect.finalReplyMentions) {
    checks.push(checkFinalReply(expect.finalReplyMentions.allOf, observation.finalReplyText));
  }

  return { passed: checks.every((c) => c.passed), checks };
}

// ---------- outcome checks for the restaurant conflict ----------

function checkCartNeverMixes(perTurn: string[][]): CheckResult {
  const badTurn = perTurn.findIndex((ids) => new Set(ids).size > 1);
  return {
    name: 'cartNeverMixesRestaurants',
    passed: badTurn === -1,
    detail:
      badTurn === -1
        ? `cart held a single restaurant after each of ${perTurn.length} turn(s)`
        : `after turn ${badTurn + 1} the cart mixed ${new Set(perTurn[badTurn]).size} restaurants`,
  };
}

/** Lowercase, no diacritics, no dish markers: the text the `finalReplyMentions` check reads. */
export function normalizeText(text: string): string {
  return text
    .replace(/\[\[dish:[^\]]*\]\]/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function checkFinalReply(groups: string[][], reply: string): CheckResult {
  const text = normalizeText(reply);
  const missing = groups.filter(
    (group) => !group.some((word) => text.includes(normalizeText(word))),
  );
  return {
    name: 'finalReplyMentions',
    passed: missing.length === 0,
    detail:
      missing.length === 0
        ? 'final reply mentions the conflict'
        : `final reply lacks any of: ${missing.map((g) => `[${g.join(' | ')}]`).join(' and ')}`,
  };
}

// ---------- tool arguments ----------

function matchesCondition(value: unknown, condition: ArgCondition): boolean {
  if (condition.equals !== undefined && value !== condition.equals) return false;
  if (condition.includes !== undefined) {
    const ok = Array.isArray(value)
      ? value.includes(condition.includes)
      : typeof value === 'string' && value.includes(condition.includes);
    if (!ok) return false;
  }
  if (condition.lte !== undefined && !(typeof value === 'number' && value <= condition.lte)) {
    return false;
  }
  if (condition.gte !== undefined && !(typeof value === 'number' && value >= condition.gte)) {
    return false;
  }
  return true;
}

function matchesAll(args: unknown, conditions: Record<string, ArgCondition>): boolean {
  if (typeof args !== 'object' || args === null) return false;
  const record = args as Record<string, unknown>;
  return Object.entries(conditions).every(([key, condition]) =>
    matchesCondition(record[key], condition),
  );
}

export function describeConditions(conditions: Record<string, ArgCondition>): string {
  return Object.entries(conditions)
    .map(([key, c]) => {
      const parts = Object.entries(c).map(([op, value]) => `${op} ${JSON.stringify(value)}`);
      return `${key} ${parts.join(' and ')}`;
    })
    .join(', ');
}

function checkToolArgs(expectation: ToolArgsExpectation, calls: ObservedToolCall[]): CheckResult {
  const alternatives = expectation.anyOf ?? (expectation.args ? [expectation.args] : []);
  const wanted = alternatives.map(describeConditions).join('  OR  ');
  const ofTool = calls.filter((c) => c.name === expectation.tool);
  const passed = ofTool.some((c) => alternatives.some((alt) => matchesAll(c.args, alt)));
  const seen = ofTool.map((c) => JSON.stringify(c.args)).join(' | ');
  return {
    name: `toolArgs:${expectation.tool}`,
    passed,
    detail: passed
      ? `a ${expectation.tool} call satisfied: ${wanted}`
      : ofTool.length === 0
        ? `${expectation.tool} was never called (wanted: ${wanted})`
        : `wanted ${wanted}; got ${seen}`,
  };
}

// ---------- recommended dishes, checked against the database ----------

function checkRecommended(
  rule: RecommendedDishesSatisfy,
  ids: string[],
  dishes: ReadonlyMap<string, DishFacts>,
): CheckResult {
  const violations: string[] = [];
  for (const id of ids) {
    const dish = dishes.get(id);
    if (!dish) {
      violations.push(`${id}: not in the catalog`);
      continue;
    }
    const problems = dishViolations(dish, rule);
    if (problems.length > 0) violations.push(`${dish.name}: ${problems.join(', ')}`);
  }
  return {
    name: 'recommendedDishesSatisfy',
    passed: violations.length === 0,
    detail:
      violations.length === 0
        ? `${ids.length} recommended dish(es), all respect the rules`
        : violations.join('; '),
  };
}

// ---------- cart ----------

function checkCart(
  expected: NonNullable<EvalCase['expect']['cartAfter']>,
  actual: Observation['cartItems'],
): CheckResult {
  const show = (items: Array<{ dishName: string; quantity: number }>): string =>
    items.length === 0 ? 'empty' : items.map((i) => `${i.quantity}x ${i.dishName}`).join(', ');
  const wanted = 'empty' in expected ? [] : expected.items;
  const key = (i: { dishName: string; quantity: number }): string => `${i.dishName}#${i.quantity}`;
  const same =
    wanted.length === actual.length &&
    [...wanted.map(key)].sort().join('|') === [...actual.map(key)].sort().join('|');
  return {
    name: 'cartAfter',
    passed: same,
    detail: same ? `cart is ${show(actual)}` : `expected ${show(wanted)}; got ${show(actual)}`,
  };
}

/** Why `dish` breaks `rule` (empty when it respects it). Also used for the catalog statistics. */
export function dishViolations(dish: DishFacts, rule: RecommendedDishesSatisfy): string[] {
  const problems: string[] = [];
  if (!dish.available) problems.push('unavailable');
  if (!dish.restaurantOpen) problems.push('restaurant closed');
  if (rule.maxPriceReais !== undefined && dish.priceCents > reaisToCents(rule.maxPriceReais)) {
    problems.push(`price ${reais(dish.priceCents)} > R$ ${rule.maxPriceReais}`);
  }
  for (const tag of rule.requiredTags ?? []) {
    if (!dish.dietaryTags.includes(tag)) problems.push(`missing tag ${tag}`);
  }
  for (const allergen of rule.excludeAllergens ?? []) {
    if (dish.allergens.includes(allergen)) problems.push(`contains ${allergen}`);
  }
  if (rule.maxDeliveryMinutes !== undefined && dish.deliveryMaxMinutes > rule.maxDeliveryMinutes) {
    problems.push(`delivery ${dish.deliveryMaxMinutes} min > ${rule.maxDeliveryMinutes}`);
  }
  if (rule.category !== undefined && dish.category !== rule.category) {
    problems.push(`category ${dish.category} != ${rule.category}`);
  }
  return problems;
}
