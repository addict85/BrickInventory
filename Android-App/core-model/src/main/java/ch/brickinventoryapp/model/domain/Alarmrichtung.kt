package ch.brickinventoryapp.model.domain

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
 * When a price alert reports. On the wire "unter" or "ueber" ([kennung]); in
 * code the type, so that no comparison with a word rebuilds the rule.
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
 * Writes the [Alarmrichtung.kennung]. Unknown reads as [Alarmrichtung.UNTER],
 * the server's default: a new value shall not discard the whole list.
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
