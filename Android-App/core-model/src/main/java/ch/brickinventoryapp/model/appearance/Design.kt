package ch.brickinventoryapp.model.appearance

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.nullable
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder

/**
 * The designs — the same list as ALLOWED in `js/theme-boot.js` and the whitelist
 * in `src/contract/globalRules.ts` (theme.test.js keeps them together). On the wire and in
 * the store stands the [identifier].
 */
@Serializable(with = DesignSerializer::class)
enum class Design(val identifier: String) {
    CLASSIC("classic"),
    BRICK("brick"),
    WORKBENCH("werkbank"),
    COLOR_FAN("farbfaecher"),
    STUD("noppe"),
    GLOSSY("hochglanz");

    companion object {
        val DEFAULT = CLASSIC

        /** null for empty or unknown: „no information“, not „back to the default“. */
        fun from(identifier: String?): Design? = entries.firstOrNull { it.identifier == identifier?.trim() }
    }
}

/** Writes the [Design.identifier]; reads unknown as [Design.DEFAULT]. */
object DesignSerializer : KSerializer<Design> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor(Design::class.java.name, PrimitiveKind.STRING)
    override fun serialize(encoder: Encoder, value: Design) = encoder.encodeString(value.identifier)
    override fun deserialize(decoder: Decoder): Design = Design.from(decoder.decodeString()) ?: Design.DEFAULT
}

/**
 * For fields in which the server may also say nothing: empty or unknown means
 * „no information“ (null) and must not overwrite a remembered design.
 */
@OptIn(ExperimentalSerializationApi::class)
object DesignOrNothing : KSerializer<Design?> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor(Design::class.java.name + "?", PrimitiveKind.STRING).nullable

    override fun serialize(encoder: Encoder, value: Design?) =
        if (value == null) encoder.encodeNull() else encoder.encodeString(value.identifier)

    override fun deserialize(decoder: Decoder): Design? =
        if (decoder.decodeNotNullMark()) Design.from(decoder.decodeString()) else decoder.decodeNull()
}
