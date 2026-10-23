'use strict';

// Invoked only by linux-runtime-smoke-test.sh, inside a fresh network namespace.
const assert = require('assert');
const fs = require('fs');
const dgram = require('dgram');
const { spawn, execFileSync } = require('child_process');
const { once } = require('events');
const { setTimeout: delay } = require('timers/promises');
const binary = process.argv[2];
const queueNumber = 6514;
assert.strictEqual(process.env.FAKESIP_TEST_NETNS, '1',
    'run through tools/linux-runtime-smoke-test.sh to isolate the test network');

function queue() {
    try {
        return fs.readFileSync('/proc/net/netfilter/nfnetlink_queue', 'utf8')
            .trim().split('\n').map(line => line.trim().split(/\s+/).map(Number))
            .find(fields => fields[0] === queueNumber);
    } catch (error) {
        if (error.code === 'ENOENT')
            return undefined;
        throw error;
    }
}

function runPeer(type, address) {
    const socket = dgram.createSocket(type);
    let originals = 0, fakes = 0, other = 0, finishing = false;
    function finish() {
        if (finishing)
            return;
        finishing = true;
        clearTimeout(deadline);
        setTimeout(() => {
            console.log(JSON.stringify({ originals, fakes, other }));
            socket.close();
        }, 30);
    }
    const deadline = setTimeout(finish, 2000);
    socket.on('message', (message, remote) => {
        if (message.equals(Buffer.from('FAKESIP_RUNTIME_ORIGINAL'))) {
            originals++;
            socket.send('FAKESIP_RUNTIME_REPLY', remote.port, remote.address);
        } else if (message.toString().startsWith('INVITE ')) {
            fakes++;
        } else {
            other++;
        }
        if (originals && fakes)
            finish();
    });
    socket.bind(0, address, () => console.log(JSON.stringify({ port: socket.address().port })));
}

async function probe(type, source, destination) {
    const sender = dgram.createSocket(type);
    const replies = [];
    sender.on('message', message => replies.push(message));
    const peer = spawn('nsenter', ['-t', process.env.FAKESIP_PEER_PID, '-n',
        process.execPath, __filename, '--peer', type, destination]);
    let output = '', errors = '';
    peer.stdout.on('data', data => { output += data; });
    peer.stderr.on('data', data => { errors += data; });
    const exited = once(peer, 'exit');
    try {
        for (let i = 0; i < 100 && !output.includes('\n'); i++)
            await delay(10);
        assert(output.includes('\n'), 'peer did not bind: ' + errors);
        const { port } = JSON.parse(output.split('\n')[0]);
        sender.bind(0, source);
        await once(sender, 'listening');
        const original = Buffer.from('FAKESIP_RUNTIME_ORIGINAL');
        await new Promise((resolve, reject) => sender.send(original,
            port, destination, error => error ? reject(error) : resolve()));
        const [code] = await exited;
        assert.strictEqual(code, 0, errors);
        const counts = JSON.parse(output.trim().split('\n')[1]);
        assert.deepStrictEqual(counts, { originals: 1, fakes: 1, other: 0 },
            `${type}: original or fake missing/duplicated`);
        assert.strictEqual(replies.length, 1, `${type}: original reply missing/duplicated`);
        assert.strictEqual(replies[0].toString(), 'FAKESIP_RUNTIME_REPLY');
    } finally {
        sender.close();
        if (peer.exitCode === null && peer.signalCode === null) {
            peer.kill('SIGKILL');
            await exited;
        }
    }
}

async function cycle(index) {
    const outbound = index % 2 === 0;
    const child = spawn(binary, ['-a', outbound ? '-1' : '-0', '-4', '-6', '-g', '-r', '1', '-s',
        '-n', String(queueNumber)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    const exited = once(child, 'exit');
    let watchdog;
    try {
        for (let i = 0; i < 200 && !output.includes('listening on'); i++) {
            assert(child.exitCode === null && child.signalCode === null, output);
            await delay(10);
        }
        assert(output.includes('listening on'), 'startup timed out: ' + output);
        assert(queue(), 'process did not own the test queue');
        await probe('udp4', '198.51.100.1', '198.51.100.2');
        await probe('udp6', '2001:db8::1', '2001:db8::2');
        const fields = queue();
        assert(fields && fields[7] > 0, 'no packets traversed the queue');
        assert.strictEqual(fields[2], 0, 'queue backlog remained');
        assert.strictEqual(fields[5], 0, 'kernel queue drops');
        assert.strictEqual(fields[6], 0, 'userspace queue drops');
        const start = performance.now();
        child.kill('SIGTERM');
        watchdog = setTimeout(() => child.kill('SIGKILL'), 2000);
        const [code, signal] = await exited;
        clearTimeout(watchdog);
        const elapsed = performance.now() - start;
        assert.strictEqual(code, 0, output);
        assert.strictEqual(signal, null, 'shutdown required a fatal signal');
        assert(elapsed < 2000, `shutdown took ${elapsed} ms`);
        assert(output.includes('exiting normally'), output);
        assert(!/ERROR:|AddressSanitizer|runtime error:/.test(output), output);
        assert(!queue(), 'queue still owned after shutdown');
        assert(!execFileSync('nft', ['list', 'ruleset'], { encoding: 'utf8' }).includes('fakesip'),
            'firewall rules survived shutdown');
        console.log(`Cycle ${index} ${outbound ? '-1' : '-0'}: IPv4/IPv6 original=1 fake=1; no drops; stop=${elapsed.toFixed(1)}ms`);
    } finally {
        clearTimeout(watchdog);
        if (child.exitCode === null && child.signalCode === null) {
            child.kill('SIGKILL');
            await exited;
        }
    }
}

if (binary === '--peer') {
    runPeer(process.argv[3], process.argv[4]);
} else (async () => {
    for (let index = 1; index <= 10; index++)
        await cycle(index);
    console.log('Linux runtime smoke tests passed.');
})().catch(error => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
