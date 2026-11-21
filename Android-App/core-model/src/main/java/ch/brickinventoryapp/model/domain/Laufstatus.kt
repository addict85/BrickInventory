package ch.brickinventoryapp.model.domain

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder

/**
 * The state of a run at the server (CSV import, background jobs of the monitoring). On
 * the wire the [kennung]; a value this version does not know reads as
 * [UNBEKANNT] and counts neither as running nor as finished.
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

    /** `pending` counts too: the job is accepted, the display shall already stand. */
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
