package ch.brickinventoryapp.model.ui.theme

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
 * Die Designs — dieselbe Liste wie ALLOWED in js/00-theme-boot.js und die Whitelist
 * in routes/settings.ts (theme.test.js hält sie zusammen). Auf der Leitung und in
 * der Ablage steht die [kennung].
 */
@Serializable(with = DesignSerializer::class)
enum class Design(val kennung: String) {
    CLASSIC("classic"),
    BRICK("brick"),
    WERKBANK("werkbank"),
    FARBFAECHER("farbfaecher"),
    NOPPE("noppe"),
    HOCHGLANZ("hochglanz");

    companion object {
        val VORGABE = CLASSIC

        /** null für leer oder unbekannt: „keine Information“, nicht „zurück auf die Vorgabe“. */
        fun aus(kennung: String?): Design? = entries.firstOrNull { it.kennung == kennung?.trim() }
    }
}

/** Schreibt die [Design.kennung]; liest Unbekanntes als [Design.VORGABE]. */
object DesignSerializer : KSerializer<Design> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor(Design::class.java.name, PrimitiveKind.STRING)
    override fun serialize(encoder: Encoder, value: Design) = encoder.encodeString(value.kennung)
    override fun deserialize(decoder: Decoder): Design = Design.aus(decoder.decodeString()) ?: Design.VORGABE
}

/**
 * Für Felder, in denen der Server auch nichts sagen darf: Leer oder unbekannt heisst
 * „keine Information“ (null) und darf ein gemerktes Design nicht überschreiben.
 */
@OptIn(ExperimentalSerializationApi::class)
object DesignOderNichts : KSerializer<Design?> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor(Design::class.java.name + "?", PrimitiveKind.STRING).nullable

    override fun serialize(encoder: Encoder, value: Design?) =
        if (value == null) encoder.encodeNull() else encoder.encodeString(value.kennung)

    override fun deserialize(decoder: Decoder): Design? =
        if (decoder.decodeNotNullMark()) Design.aus(decoder.decodeString()) else decoder.decodeNull()
}
