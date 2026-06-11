import smpp from 'smpp';

console.log('=========================================');
console.log('Testing ESME Connection to SMPP Server');
console.log('=========================================\n');

const session = smpp.connect({ host: 'localhost', port: 2775 });

session.on('connect', () => {
    console.log('✅ Connected to SMPP server');
    
    session.bind_transceiver({
        system_id: 'techcorp_smpp',
        password: 'secure123'
    }, (pdu) => {
        if (pdu.command_status === 0) {
            console.log('✅ ESME Bind SUCCESS!');
            console.log('   Status: BOUND_TRX\n');
            
            // Send test message
            session.submit_sm({
                source_addr: 'TEST',
                destination_addr: '1234567890',
                short_message: 'Test SMS from ESME client via SMPP'
            }, (submitResp) => {
                if (submitResp.command_status === 0) {
                    console.log('✅ Test message sent successfully');
                    console.log(`   Message ID: ${submitResp.message_id}`);
                } else {
                    console.log('❌ Failed to send message');
                }
                session.close();
                process.exit();
            });
        } else {
            console.log('❌ ESME Bind FAILED');
            console.log(`   Error code: ${pdu.command_status}`);
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
    console.log('❌ Timeout - SMPP server not responding');
    process.exit();
}, 5000);
