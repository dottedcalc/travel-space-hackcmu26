import test from 'node:test';
import assert from 'node:assert/strict';
import { agentsAtStep } from '../lib/simulation.ts';
import { crowdTracePath } from '../lib/crowd-traces.ts';

function fixture() {
  const agent = { id: 1, start: 10, endStep: 25, weight: 10, type: 'viewer',
    state: 'finished', entranceId: 'in', exitId: 'out', route: ['booth'],
    path: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }],
    pathSteps: [0, 2, 8, 10],
    queueVisits: [{ itemId: 'booth', joined: 12, serviceStart: 12, serviceEnd: 18, departed: 18 }] };
  return { agents: [agent] };
}
const tracesAt = (simulation, time) => agentsAtStep(simulation, time).map(({ agent, pathIndex, point }) =>
  ({ agent, path: crowdTracePath(agent, pathIndex, point) }));

test('a group trace grows from its entrance without displaying future travel', () => {
  const simulation = fixture();
  assert.deepEqual(tracesAt(simulation, 9), []);
  assert.equal(tracesAt(simulation, 10)[0].path, '');
  assert.equal(tracesAt(simulation, 11)[0].path, 'M0.00,0.00L20.00,0.00');
  assert.equal(tracesAt(simulation, 19)[0].path, 'M0.00,0.00L40.00,0.00L40.00,20.00');
  assert.equal(tracesAt(simulation, 20)[0].path, 'M0.00,0.00L40.00,0.00L40.00,40.00');
});

test('queueing keeps the full traveled route and departure removes it', () => {
  const simulation = fixture();
  for (const time of [12, 13.5, 16, 18]) assert.equal(tracesAt(simulation, time)[0].path, 'M0.00,0.00L40.00,0.00');
  assert.equal(tracesAt(simulation, 24.5)[0].path, 'M0.00,0.00L40.00,0.00L40.00,40.00');
  assert.deepEqual(tracesAt(simulation, 25), []);
  assert.deepEqual(tracesAt(simulation, 100), []);
  assert.equal(tracesAt(simulation, 11.5)[0].path, 'M0.00,0.00L30.00,0.00', 'Rewind must remove future coordinates');
  assert.equal(tracesAt(simulation, 10)[0].path, '');
});

test('one group leaving does not erase another active group', () => {
  const simulation = fixture(), first = simulation.agents[0];
  const later = { ...first, id: 2, start: 20, endStep: 35 };
  simulation.agents.push(later);
  assert.deepEqual(tracesAt(simulation, 26).map(({ agent }) => agent.id), [2]);
  assert.equal(tracesAt(simulation, 26)[0].path, 'M0.00,0.00L40.00,0.00');
});

test('appending an arbitrary future detour cannot affect the currently rendered path', () => {
  const simulation = fixture();
  const before = tracesAt(simulation, 11.5)[0].path;
  const agent = { ...simulation.agents[0], path: [...simulation.agents[0].path,
    { x: 999, y: 999 }], pathSteps: [0, 2, 8, 10, 14] };
  const after = tracesAt({ agents: [agent] }, 11.5)[0].path;
  assert.equal(after, before);
  assert.ok(!after.includes('19980'));
});
