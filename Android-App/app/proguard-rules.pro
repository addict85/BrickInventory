-keepattributes *Annotation*
-keep class ch.brickinventoryapp.data.model.** { *; }
-keepnames class kotlinx.serialization.** { *; }
-keepclassmembers class kotlinx.serialization.** { *; }

# ── ML Kit / Play Services ────────────────────────────────────────────────────
# ML Kit ist Closed Source und stark reflexionsbasiert (Registrar-Discovery über
# Manifest-Metadaten, interne Komponenten-Verdrahtung). Das aggressivere R8 unter
# AGP 9 verursachte nacheinander zwei Release-Crashes:
#   1. "Invalid component registrar … NoSuchMethodException: <init> []"
#   2. NPE auf internem Feld in BarcodeScanning.getClient()
# Chirurgische Regeln (nur Registrar-Konstruktoren) reichten nicht — daher werden
# die ML-Kit-Pakete komplett vom Shrinking/Optimieren ausgenommen. Kostet etwas
# APK-Grösse, ist aber der zuverlässige, etablierte Weg für ML Kit + R8 full mode.
-keep class com.google.mlkit.** { *; }
-keep class com.google.android.gms.internal.mlkit_vision_barcode.** { *; }
-keep class com.google.android.gms.internal.mlkit_vision_common.** { *; }
-keep class com.google.android.gms.internal.mlkit_common.** { *; }
-keep class com.google.android.gms.common.** { *; }
-keep class * implements com.google.firebase.components.ComponentRegistrar {
    <init>();
}
-dontwarn com.google.mlkit.**
-dontwarn com.google.android.gms.**
