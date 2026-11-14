-keepattributes *Annotation*
# Die API-Modelle werden umbenannt wie jede Klasse (sec17 B-N10): Die Feldnamen im JSON
# stehen im erzeugten Serializer; Companion, serializer() und INSTANCE hält die Regel, die
# kotlinx-serialization-core mitbringt (META-INF/com.android.tools/r8). Die Bibliothek lädt
# selbst nichts über Namen, darum bleibt sie nicht mehr ganz stehen.
# tools/apk-pruefen.py prüft am fertigen APK, dass ein Modell umbenannt ist.

# Navigation lädt den Typ eines Enum-Felds einer Route über seinen Namen (Class.forName);
# umbenannt fände es ihn nicht. core-model ist reines Kotlin und kennt kein @Keep.
-keep enum ch.brickinventoryapp.model.fach.Postenart { *; }
-keep enum ch.brickinventoryapp.model.fach.Zustand { *; }
-keep enum ch.brickinventoryapp.model.ui.Scannerherkunft { *; }

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
# Bewusst breit (sec17 B-N10 geprüft): Code von Google, kein eigener; sein Klartext verrät
# nichts über die App. Enger gefasst kamen die beiden Abstürze oben.
-keep class com.google.android.gms.common.** { *; }
-keep class * implements com.google.firebase.components.ComponentRegistrar {
    <init>();
}
-dontwarn com.google.mlkit.**
-dontwarn com.google.android.gms.**

# ── Eigene Worker: Konstruktor UND doWork() ──────────────────────────────────
# WorkManagers eigene Regel hält nur den Konstruktor; doWork() ruft allein das
# Framework, und R8 nahm es einmal samt allem Dahinter heraus (Preisalarm stumm).
# Nur diese beiden Glieder, nur im eigenen Baum: Der Rest wird geschrumpft und
# umbenannt wie jede andere Klasse. Geprüft am fertigen APK (tools/apk-pruefen.py).
-keep class ch.brickinventoryapp.** extends androidx.work.ListenableWorker {
    public <init>(android.content.Context, androidx.work.WorkerParameters);
    *** doWork(...);
}

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

# ── Kein Logcat im Release ───────────────────────────────────────────────────
# util/Protokoll.kt schreibt im Release ohnehin nichts. Diese Regel nimmt auch
# die Aufrufe der Bibliotheken heraus: Deren Texte nennen Adressen samt Abfrage
# und Ausnahmen, und Logcat liest jeder mit adb oder einem Fehlerbericht mit.
-assumenosideeffects class android.util.Log {
    public static int v(...);
    public static int d(...);
    public static int i(...);
    public static int w(...);
    public static int e(...);
    public static int wtf(...);
    public static int println(...);
}
