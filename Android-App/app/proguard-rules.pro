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

# ── Rooms erzeugte Datenbank-Implementierungen ────────────────────────────────
#
# GEMESSEN auf Marcos Geraet, Release-APK vom 25.09. Die App zeigte beim
# Umlegen des Preisalarm-Schalters:
#
#     Preisalarm konnte nicht eingeplant werden:
#     androidx.work.impl.WorkDatabase_Impl.<init> []
#
# Das ist die Meldung einer NoSuchMethodException, und sie sagt praezise, was
# fehlt. Room laedt seine erzeugte Implementierung ueber den NAMEN:
#
#     Class.forName("androidx.work.impl.WorkDatabase_Impl")
#         .getDeclaredConstructor()      <- hier fliegt es
#         .newInstance()
#
# Die Klasse war also DA — sonst haette es eine ClassNotFoundException gegeben.
# Weg war allein ihr parameterloser Konstruktor. Statisch ruft ihn niemand auf,
# und unter R8 full mode (Vorgabe seit AGP 8, hier 9.2.1) reicht die
# mitgelieferte Regel von Room dafuer nicht aus.
#
# ── Warum das die ANTWORT auf eine alte offene Frage ist ─────────────────────
#
# Im Manifest steht seit Monaten, WorkManager sei auf Marcos Geraet beim
# Hochfahren gescheitert, und: „WARUM er gescheitert ist, weiss bis heute
# niemand, und es wird sich auch nicht mehr herausfinden lassen."
#
# Doch, jetzt schon. WorkManager oeffnet beim Hochfahren genau diese Datenbank.
# Der Absturz beim App-Start und der Fehlschlag am Schalter sind DERSELBE
# Fehler an zwei Stellen — nur hat ihn beim zweiten Mal jemand angezeigt,
# statt ihn die App mitreissen zu lassen.
#
# ── Die dritte Ausprägung derselben Falle ───────────────────────────────────
#
# Oben steht sie zweimal: ML Kit („NoSuchMethodException: <init> []") und der
# eigene Worker. Immer dasselbe Muster — wer eine Klasse nur ueber Reflexion
# oder das Framework erreicht, muss sie UND das benutzte Glied benennen.
#
# Allgemein statt auf WorkDatabase_Impl gemuenzt: Jede kuenftige Room-Datenbank
# in diesem Baum wird genauso geladen und fiele in dieselbe Grube. `extends`
# wirkt in ProGuard transitiv, WorkDatabase_Impl -> WorkDatabase -> RoomDatabase
# ist damit erfasst.
-keep class * extends androidx.room.RoomDatabase { <init>(); }
