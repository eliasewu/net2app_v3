# NET2APP SMS Gateway — Java 21 SMPP Engine
# Build: mvn clean package
# Run:   java -jar target/sms-gateway-1.0.0.jar
# Or:    mvn exec:java -Dexec.mainClass="com.net2app.gateway.SmpGatewayMain"

echo "Building Java SMPP Gateway..."
cd /home/ubuntu/net2app-v3/java-sms-gateway

# Check if Maven is installed
if ! command -v mvn &> /dev/null; then
    echo "Maven not found. Installing..."
    sudo apt-get update && sudo apt-get install -y maven default-jdk
fi

mvn clean package -DskipTests

if [ $? -eq 0 ]; then
    echo "Build successful!"
    echo "JAR: target/sms-gateway-1.0.0.jar"
    echo ""
    echo "To run:"
    echo "  java -jar target/sms-gateway-1.0.0.jar"
    echo ""
    echo "To run with custom DB:"
    echo "  DB_HOST=localhost DB_NAME=sms_platform DB_USER=sms_user DB_PASS=xxx java -jar target/sms-gateway-1.0.0.jar"
else
    echo "Build failed. Check errors above."
fi
