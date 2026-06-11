// Update the SMS Sheba endpoint response handling
// Find the line that checks response.data.status and replace with this:

if (response.data.response && response.data.response[0]) {
  const apiResponse = response.data.response[0];
  if (apiResponse.status === 0) {
    const apiMessageId = apiResponse.id;
    
    await pool.query(
      `UPDATE sms_logs 
       SET status = 'delivered', 
           dlr_status = 'DELIVRD',
           delivery_time = NOW(),
           supplier_response = $1,
           smpp_message_id = $2
       WHERE message_id = $3`,
      [JSON.stringify(apiResponse), apiMessageId, messageId]
    );
    
    res.json({ success: true, message: 'SMS delivered', message_id: apiMessageId, response: apiResponse });
  } else {
    await pool.query(
      `UPDATE sms_logs SET status = 'failed', error_message = $1 WHERE message_id = $2`,
      [`API status: ${apiResponse.status}`, messageId]
    );
    res.json({ success: false, error: 'SMS failed', response: apiResponse });
  }
} else {
  res.json({ success: false, error: 'Invalid response from SMS Sheba' });
}
