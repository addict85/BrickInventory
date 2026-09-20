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

# ── Eigene Worker: R8 behielt nur den Konstruktor ─────────────────────────────
# GEMESSEN am Release-APK von main (120c998), aus dem DEX gelesen:
#
#     Lch/brickinventoryapp/alarm/PreisalarmWorker;
#        direkt   (1): <init>
#        virtuell (0):
#
# Der Worker war eine leere Huelle. doWork() fehlte, die ganze Companion mit
# einplanen() und zeige() ebenfalls — der Preisalarm konnte auf dem Geraet
# NIE funktionieren, obwohl 470 Unit-Tests gruen waren.
#
# Der Grund ist die Keep-Regel, die WorkManager selbst mitbringt:
#
#     -keep class * extends androidx.work.ListenableWorker {
#         public <init>(android.content.Context, androidx.work.WorkerParameters); }
#
# Sie nennt Klasse und Konstruktor — mehr nicht. Alles Weitere muss R8 ueber
# Aufrufe finden, und doWork() ruft NIEMAND im Baum auf: Das tut allein das
# Framework. Also fiel es weg, zusammen mit den beiden Strings, die nur dort
# referenziert waren (alert_channel_name/_desc verschwanden dadurch auch aus
# resources.arsc — der Ressourcen-Schrumpfer war im Recht, es gab wirklich
# keine Referenz mehr).
#
# Dass es dem ML-Kit-Block oben zweimal genauso ergangen ist, steht dort. Es
# ist dieselbe Falle: Wer die Klasse nur ueber das Framework erreicht, muss
# ihre Methoden benennen.
#
# Bewusst auf den EIGENEN Baum begrenzt: `* extends ListenableWorker` naehme
# auch die internen Worker von WorkManager (DiagnosticsWorker, ConstraintTracking)
# vom Schrumpfen aus, ohne dass jemand darum gebeten haette.
-keep class ch.brickinventoryapp.alarm.** { *; }
