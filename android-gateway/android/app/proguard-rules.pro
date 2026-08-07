# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.

# Keep jsmpp SMPP library classes
-keep class org.jsmpp.** { *; }
-keep class com.net2app.gateway.SmppGatewayClient { *; }

# Keep Room database entities and DAOs
-keep class com.net2app.gateway.OfflineMessage { *; }
-keep class com.net2app.gateway.OfflineMessageDao { *; }
-keep class com.net2app.gateway.AppDatabase { *; }
-keep class com.net2app.gateway.OfflineQueueManager { *; }

# Keep Capacitor plugin
-keep class com.net2app.gateway.SmsGatewayPlugin { *; }

# Keep SLF4J
-keep class org.slf4j.** { *; }

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile
