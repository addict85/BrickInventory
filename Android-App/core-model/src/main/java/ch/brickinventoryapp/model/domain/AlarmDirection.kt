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
 * When a price alert reports. On the wire "below" or "above" ([identifier]); in
 * code the type, so that no comparison with a word rebuilds the rule. [v1] is the
 * value of API v1: rows stored before the move to v2 still carry it.
 */
@Serializable(with = AlarmDirectionSerializer::class)
enum class AlarmDirection(val identifier: String, private val v1: String) {
    BELOW("below", "unter"),
    OVER("above", "ueber");

    companion object {
        fun from(identifier: String?): AlarmDirection? = identifier?.trim()?.lowercase()?.let { w ->
            entries.firstOrNull { it.identifier == w || it.v1 == w }
        }
    }
}

/**
 * Writes the [AlarmDirection.identifier]. Unknown reads as [AlarmDirection.BELOW],
 * the server's default: a new value shall not discard the whole list.
 */
@OptIn(InternalSerializationApi::class, ExperimentalSerializationApi::class)
object AlarmDirectionSerializer : KSerializer<AlarmDirection> {
    override val descriptor: SerialDescriptor =
        buildSerialDescriptor(AlarmDirection::class.java.name, SerialKind.ENUM) {
            AlarmDirection.entries.forEach { element(it.identifier, buildSerialDescriptor(it.identifier, StructureKind.OBJECT)) }
        }

    override fun serialize(encoder: Encoder, value: AlarmDirection) = encoder.encodeString(value.identifier)

    override fun deserialize(decoder: Decoder): AlarmDirection = AlarmDirection.from(decoder.decodeString()) ?: AlarmDirection.BELOW
}
