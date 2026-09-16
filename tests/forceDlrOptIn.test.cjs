/**
 * Push/Force DLR must be strictly OPT-IN.
 *
 * Extracts `forceDlrEnabled` and `resolveForceDlrTimeout` from the real
 * server.cjs (rather than re-declaring them here) so the test fails if the
 * shipped behaviour drifts.
 *
 * Run: node tests/forceDlrOptIn.test.cjs
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const serverPath = path.join(__dirname, '..', 'server.cjs');
const src = fs.readFileSync(serverPath, 'utf8');

function extract(name) {
    const start = src.indexOf(`function ${name}(`);
    assert.ok(start !== -1, `could not find ${name} in server.cjs`);
    // walk braces to the end of the function
    let i = src.indexOf('{', start);
    let depth = 0;
    for (let j = i; j < src.length; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') {
            depth--;
            if (depth === 0) return src.slice(start, j + 1);
        }
    }
    throw new Error(`unterminated ${name}`);
}

const forceDlrEnabled = eval(`(${extract('forceDlrEnabled')})`);
const resolveForceDlrTimeout = eval(`(${extract('resolveForceDlrTimeout')})`);

let pass = 0, fail = 0;
function check(label, actual, expected) {
    try {
        assert.deepStrictEqual(actual, expected);
        console.log(`  ✓ ${label}`);
        pass++;
    } catch (e) {
        console.log(`  ✗ ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
        fail++;
    }
}

console.log('forceDlrEnabled — NULL/absent must mean OFF (opt-in)');
check('undefined → off', forceDlrEnabled(undefined), false);
check('null → off', forceDlrEnabled(null), false);
check('0 → off', forceDlrEnabled(0), false);
check("'false' → off", forceDlrEnabled('false'), false);
check("'' → off", forceDlrEnabled(''), false);
check("'no' → off", forceDlrEnabled('no'), false);
check('false → off', forceDlrEnabled(false), false);
check('true → on', forceDlrEnabled(true), true);
check("'true' → on", forceDlrEnabled('true'), true);
check('1 → on', forceDlrEnabled(1), true);
check("'1' → on", forceDlrEnabled('1'), true);

console.log('\nresolveForceDlrTimeout — push DLR lands in a 0-5s window');
const samples = [];
for (let i = 0; i < 500; i++) samples.push(resolveForceDlrTimeout('random_0_5', 0));
check('random_0_5 always within 0..5', samples.every(s => s >= 0 && s <= 5), true);
check('random_0_5 covers 0', samples.includes(0), true);
check('random_0_5 covers 5', samples.includes(5), true);
check('fixed 7 honoured', resolveForceDlrTimeout('fixed', 7), 7);
check('fixed 0 falls back to 0-5 window', (() => {
    const v = resolveForceDlrTimeout('fixed', 0);
    return v >= 0 && v <= 5;
})(), true);
check('unknown mode falls back to 0-5 window', (() => {
    const v = resolveForceDlrTimeout('nonsense', 0);
    return v >= 0 && v <= 5;
})(), true);
const r15 = [];
for (let i = 0; i < 300; i++) r15.push(resolveForceDlrTimeout('random_1_5', 0));
check('random_1_5 stays 1..5', r15.every(s => s >= 1 && s <= 5), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
