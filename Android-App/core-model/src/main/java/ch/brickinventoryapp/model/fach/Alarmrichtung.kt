package ch.brickinventoryapp.model.fach

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.InternalSerializationApi
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.SerialKind
import kotlinx.serialization.descriptors.StructureKind
import kotlinx.serialization.descriptors.buildSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder

/**
 * Wann ein Preisalarm meldet. Auf der Leitung "unter" oder "ueber" ([kennung]); im
 * Code der Typ, damit kein Vergleich mit einem Wort die Regel nachbaut.
 */
@Serializable(with = AlarmrichtungSerializer::class)
enum class Alarmrichtung(val kennung: String) {
    UNTER("unter"),
    UEBER("ueber");

    companion object {
        fun aus(kennung: String?): Alarmrichtung? = entries.firstOrNull { it.kennung == kennung?.trim()?.lowercase() }
    }
}

/**
 * Schreibt die [Alarmrichtung.kennung]. Unbekanntes liest sich als [Alarmrichtung.UNTER],
 * der Vorgabe des Servers: Ein neuer Wert soll nicht die ganze Liste verwerfen.
 */
@OptIn(InternalSerializationApi::class, ExperimentalSerializationApi::class)
object AlarmrichtungSerializer : KSerializer<Alarmrichtung> {
    override val descriptor: SerialDescriptor =
        buildSerialDescriptor(Alarmrichtung::class.java.name, SerialKind.ENUM) {
            Alarmrichtung.entries.forEach { element(it.kennung, buildSerialDescriptor(it.kennung, StructureKind.OBJECT)) }
        }

    override fun serialize(encoder: Encoder, value: Alarmrichtung) = encoder.encodeString(value.kennung)

    override fun deserialize(decoder: Decoder): Alarmrichtung = Alarmrichtung.aus(decoder.decodeString()) ?: Alarmrichtung.UNTER
}
