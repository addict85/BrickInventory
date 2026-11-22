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
 * Condition of an item. On the wire it is called "N" or "U" ([identifier]); in code
 * stands the type, so that no comparison with a letter rebuilds the rule.
 * Unknown reads as [NEW], as in the server (`=== 'U' ? 'U' : 'N'`): a new
 * value shall not discard the whole list.
 */
@Serializable(with = StateSerializer::class)
enum class Condition(val identifier: String) {
    NEW("N"),
    USED("U");

    companion object {
        /** null for empty or unknown — the caller decides what applies then. */
        fun from(identifier: String?): Condition? = entries.firstOrNull { it.identifier.equals(identifier?.trim(), ignoreCase = true) }
    }
}

/**
 * Writes the [Condition.identifier]. The descriptor is an enum type under the name
 * of the class, like the generated one: Navigation recognizes a route field as enum by it.
 */
@OptIn(InternalSerializationApi::class, ExperimentalSerializationApi::class)
object StateSerializer : KSerializer<Condition> {
    override val descriptor: SerialDescriptor =
        buildSerialDescriptor(Condition::class.java.name, SerialKind.ENUM) {
            Condition.entries.forEach { element(it.identifier, buildSerialDescriptor(it.identifier, StructureKind.OBJECT)) }
        }

    override fun serialize(encoder: Encoder, value: Condition) = encoder.encodeString(value.identifier)

    override fun deserialize(decoder: Decoder): Condition = Condition.from(decoder.decodeString()) ?: Condition.NEW
}
