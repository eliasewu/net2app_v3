# Java 21 SMPP Gateway — NET2APP Hub

High-performance SMPP 3.4 gateway written in Java 21.

## Architecture

```
                    ┌──────────────────────────┐
                    │   Node.js (server.cjs)    │
                    │   REST API + Web UI       │
                    │   Port: 3001              │
                    └──────────┬───────────────┘
                               │ HTTP (port 9090)
                    ┌──────────▼───────────────┐
                    │  Java 21 SMPP Gateway     │
                    │                           │
                    │  Server Mode (port 2775)   │
                    │  ┌─────────────────────┐  │
                    │  │ ESME clients connect │  │
                    │  │ GSM modems pair      │  │
                    │  └─────────────────────┘  │
                    │                           │
                    │  Client Mode              │
                    │  ┌─────────────────────┐  │
                    │  │ Connects to SMSCs    │  │
                    │  │ Delivers SMS + DLR   │  │
                    │  └─────────────────────┘  │
                    │                           │
                    └──────────┬───────────────┘
                               │ JDBC
                    ┌──────────▼───────────────┐
                    │   PostgreSQL              │
                    │   sms_platform            │
                    └──────────────────────────┘
```

## Modes

### Server Mode (ESME/GSM Modem)
- Listens on port 2775 for SMPP client bind requests
- **GSM Modems/Devices**: Devices without public IP pair with this server using server IP:2775 + smpp_username + smpp_password
- Authenticates via `clients` or `suppliers` table in PostgreSQL
- Accepts `submit_sm` PDUs, routes through platform, delivers via client mode

### Client Mode (SMSC/Supplier)
- Connects to external SMSCs configured in the `suppliers` table
- Sends SMS via `submit_sm` to suppliers
- Receives DLR via `deliver_sm` from suppliers
- Auto-reconnect with exponential backoff

## Build & Run

```bash
# Build
cd java-sms-gateway
mvn clean package -DskipTests

# Run
java -jar target/sms-gateway-1.0.0.jar

# With custom DB
DB_HOST=localhost DB_NAME=sms_platform DB_USER=sms_user DB_PASS=xxx java -jar target/sms-gateway-1.0.0.jar
```

## REST Bridge (port 9090)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Gateway health check |
| `/sessions` | GET | List active SMPP sessions |
| `/reconnect/:id` | POST | Force reconnect supplier |
| `/stats` | GET | JVM memory/thread stats |

## Integration with Node.js

The Java SMPP gateway shares the same PostgreSQL database as Node.js `server.cjs`. SMS logs are written to the `sms_logs` table by both components.

Node.js queries the REST bridge at port 9090 for real-time SMPP status.
