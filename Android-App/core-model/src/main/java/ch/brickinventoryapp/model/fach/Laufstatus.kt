package ch.brickinventoryapp.model.fach

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder

/**
 * Der Stand eines Laufs am Server (CSV-Import, Hintergrundjobs der Überwachung). Auf
 * der Leitung die [kennung]; ein Wert, den diese Fassung nicht kennt, liest sich als
 * [UNBEKANNT] und zählt weder als laufend noch als fertig.
 */
@Serializable(with = LaufstatusSerializer::class)
enum class Laufstatus(val kennung: String) {
    RUHT("idle"),
    WARTET("pending"),
    LAEUFT("running"),
    FERTIG("done"),
    FEHLER("error"),
    ABGEBROCHEN("cancelled"),
    UNBEKANNT("");

    /** `pending` zählt mit: Der Auftrag ist angenommen, die Anzeige soll schon stehen. */
    val laeuft: Boolean get() = this == LAEUFT || this == WARTET

    companion object {
        fun aus(kennung: String?): Laufstatus = entries.firstOrNull { it != UNBEKANNT && it.kennung == kennung } ?: UNBEKANNT
    }
}

object LaufstatusSerializer : KSerializer<Laufstatus> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor(Laufstatus::class.java.name, PrimitiveKind.STRING)
    override fun serialize(encoder: Encoder, value: Laufstatus) = encoder.encodeString(value.kennung)
    override fun deserialize(decoder: Decoder): Laufstatus = Laufstatus.aus(decoder.decodeString())
}
