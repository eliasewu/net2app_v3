import smpp from 'smpp';

// Use real client credentials from the database
// TriAngle: system_id='tuesday', destination to a real BD number
const CLIENT = {
    system_id: 'tuesday',
    password: 'Tri2025',       // TriAngle's SMPP password from DB
    source_addr: 'TriAngle',
    destination: '8801615069178',
    message: 'E2E-REAL-SMPP: Test from ESME via Java Gateway'
};

console.log('=========================================');
console.log('Testing REAL ESME Connection to SMPP Server');
console.log(`Client: ${CLIENT.system_id} → ${CLIENT.destination}`);
console.log('=========================================\n');

const session = smpp.connect({ host: 'localhost', port: 2775 });

session.on('connect', () => {
    console.log('✅ Connected to SMPP server (Java Gateway :2775)');
    
    session.bind_transceiver({
        system_id: CLIENT.system_id,
        password: CLIENT.password
    }, (pdu) => {
        if (pdu.command_status === 0) {
            console.log('✅ ESME Bind SUCCESS!');
            console.log(`   System ID: ${pdu.system_id || CLIENT.system_id}`);
            console.log('   Status: BOUND_TRX\n');
            
            // Send test message to real destination
            session.submit_sm({
                source_addr: CLIENT.source_addr,
                destination_addr: CLIENT.destination,
                short_message: CLIENT.message
            }, (submitResp) => {
                if (submitResp.command_status === 0) {
                    console.log('✅ Test message submitted successfully');
                    console.log(`   Message ID: ${submitResp.message_id}`);
                    console.log(`   Destination: ${CLIENT.destination}`);
                    console.log(`   Text: ${CLIENT.message}`);
                } else {
                    console.log('❌ Failed to submit message');
                    console.log(`   Command status: ${submitResp.command_status}`);
                }
                session.close();
                process.exit();
            });
        } else {
            console.log('❌ ESME Bind FAILED');
            console.log(`   Command status: ${pdu.command_status}`);
            session.close();
            process.exit();
        }
    });
});

session.on('error', (err) => {
    console.log('❌ Connection failed:', err.message);
    process.exit();
});

setTimeout(() => {
    console.log('❌ Timeout — SMPP server not responding');
    process.exit();
}, 8000);
