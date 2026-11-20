package ch.brickinventoryapp.contract

import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.model.domain.Herkunft
import ch.brickinventoryapp.model.util.zeitpunkt
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import java.lang.reflect.Method
import java.lang.reflect.Modifier
import java.lang.reflect.ParameterizedType
import java.lang.reflect.Type
import java.lang.reflect.WildcardType
import java.time.Instant

/**
 * Baut Server-Modelle, in denen jedes Feld einen eigenen Wert hat, und
 * vergleicht sie mit ihrer Ansicht — über Java-Reflexion, damit jede neue
 * Abbildung in contract/abbildung ohne eigenen Test mitgeprüft wird.
 */
object Beispielfueller {
    private var counter = 0

    /**
     * Die Dateien in contract/abbildung, beim Namen genannt: Unter Gradle
     * liegen die Hauptklassen in einem Jar, ein Ordner-Durchgang fand dort nichts.
     * Dass die Liste vollständig ist, prüft UiModelFigureTest am Quelltext.
     */
    val ABBILDUNGSDATEIEN = listOf(
        "EinzelAbbildungen", "FinanzAbbildungen", "GutscheinKlartextAbbildung", "HaushaltAbbildungen", "HintergrundAbbildungen",
        "KatalogAbbildungen", "KontoAbbildungen", "PreisAbbildungen", "SetAbbildungen", "TeileAbbildungen", "VerwaltungAbbildungen",
    )

    /** Alle `alsAnsicht(<vertrag.X>)` der Dateien in [ABBILDUNGSDATEIEN]. */
    fun figures(): List<Method> {
        return ABBILDUNGSDATEIEN.map { Class.forName("ch.brickinventoryapp.contract.mapping.${it}Kt") }
            .flatMap { k -> k.methods.filter { it.name == "alsAnsicht" && it.parameterCount == 1 } }
            .filter { it.parameterTypes[0].name.startsWith("ch.brickinventoryapp.contract.") && !it.parameterTypes[0].isEnum }
            .sortedBy { it.parameterTypes[0].name }
    }

    private val additions = Class.forName("ch.brickinventoryapp.contract.ErgaenzungenKt").methods.toList()

    /** Ein Wert vom Typ [typ]; Datenklassen über ihren vollständigen Konstruktor, jedes Feld anders. */
    fun fill(typ: Type): Any? {
        val k = when (typ) {
            is Class<*> -> typ
            is ParameterizedType -> typ.rawType as Class<*>
            is WildcardType -> return fill(typ.upperBounds[0])
            else -> error("Typ $typ")
        }
        counter++
        return when {
            k == Int::class.javaPrimitiveType || k == Int::class.javaObjectType -> 100 + counter
            k == Long::class.javaPrimitiveType || k == Long::class.javaObjectType -> 1000L + counter
            k == Double::class.javaPrimitiveType || k == Double::class.javaObjectType -> counter + 0.25
            k == Float::class.javaPrimitiveType || k == Float::class.javaObjectType -> counter + 0.5f
            k == Boolean::class.javaPrimitiveType || k == Boolean::class.javaObjectType -> counter % 2 == 0
            k == String::class.java -> "w$counter"
            k.isEnum -> k.enumConstants.last()
            JsonElement::class.java.isAssignableFrom(k) -> JsonObject(mapOf("k$counter" to JsonPrimitive(counter)))
            List::class.java.isAssignableFrom(k) -> {
                val t = (typ as ParameterizedType).actualTypeArguments[0]
                listOf(fill(t), fill(t))
            }
            Map::class.java.isAssignableFrom(k) ->
                mapOf("k$counter" to fill((typ as ParameterizedType).actualTypeArguments[1]))
            else -> {
                val c = k.declaredConstructors
                    .filter { kon -> kon.parameterTypes.none { it.name.endsWith("ConstructorMarker") } }
                    .maxBy { it.parameterCount }
                c.isAccessible = true
                c.newInstance(*c.genericParameterTypes.map { fill(it) }.toTypedArray())
            }
        }
    }

    /**
     * Vergleicht die gleichnamigen Getter von [dto] und [ansicht], verschachtelt;
     * Getter ohne Gegenstück landen in [ohne]. Gibt die Zahl der verglichenen Felder.
     */
    fun compare(dto: Any?, ansicht: Any?, pfad: String, ohne: MutableSet<String>): Int {
        if (ansicht == null || dto == null || !ansicht.javaClass.name.startsWith("ch.brickinventoryapp.model.domain.")) {
            assertEquals(pfad, dto, ansicht)
            return 1
        }
        val k = ansicht.javaClass
        var n = 0
        for (g in getter(k)) {
            val gegen = counterpart(dto, g)
            // Abgeleitete Werte der erzeugten Typen stehen als Erweiterung in Ergaenzungen.kt.
            val extended = additions.firstOrNull { it.name == g.name.substringBefore('-') && it.parameterTypes.singleOrNull() == dto.javaClass }
            val wert = when {
                gegen != null -> gegen.invoke(dto)
                extended != null -> extended.invoke(null, dto)
                else -> { ohne += "${dto.javaClass.simpleName}.${g.name}"; continue }
            }
            n += compareValue(fachwert(wert, g.returnType), g.invoke(ansicht), "$pfad.${g.name}", ohne)
        }
        return n
    }

    /** Statische Getter (Herkunft.getEntries) gehören zur Klasse, nicht zum Wert. */
    private fun getter(k: Class<*>): List<Method> = k.methods.filter {
        it.parameterCount == 0 && it.declaringClass == k && !Modifier.isStatic(it.modifiers) &&
            (it.name.startsWith("get") || it.name.startsWith("is"))
    }

    /** Ein Getter auf eine value class trägt einen Anhang (getAmount-…); Geld und Double haben verschiedene. */
    private fun counterpart(dto: Any, g: Method): Method? =
        dto.javaClass.methods.firstOrNull { it.name == g.name && it.parameterCount == 0 }
            ?: dto.javaClass.methods.firstOrNull { it.parameterCount == 0 && "-" in g.name && it.name == g.name.substringBefore('-') }

    /** Der Wert des Server-Modells, wie die Abbildung ihn lesen soll: Betrag als Geld, Zeit als Instant. */
    private fun fachwert(d: Any?, typ: Class<*>): Any? = when {
        d is Double && typ == Geld::class.java -> Geld.aus(d)
        d is Double && typ == Long::class.javaPrimitiveType -> Geld.aus(d)?.tenThousandths
        typ == Instant::class.java -> zeitpunkt(d as String?)
        typ == Herkunft::class.java -> Herkunft.aus(d as String?)
        else -> d
    }

    /** Listen und Maps Eintrag für Eintrag, alles andere über [compare]. */
    private fun compareValue(d: Any?, a: Any?, pfad: String, ohne: MutableSet<String>): Int = when {
        a is List<*> && d is List<*> -> {
            assertEquals("$pfad (Länge)", d.size, a.size)
            a.indices.sumOf { compare(d[it], a[it], "$pfad[$it]", ohne) }
        }
        a is Map<*, *> && d is Map<*, *> -> {
            assertEquals("$pfad (Schlüssel)", d.keys, a.keys)
            a.keys.sumOf { compare(d[it], a[it], "$pfad[$it]", ohne) }
        }
        else -> compare(d, a, pfad, ohne)
    }
}
