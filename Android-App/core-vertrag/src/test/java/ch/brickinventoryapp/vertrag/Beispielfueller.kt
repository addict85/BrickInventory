package ch.brickinventoryapp.vertrag

import org.junit.Assert.assertEquals
import java.lang.reflect.Method
import java.lang.reflect.ParameterizedType
import java.lang.reflect.Type
import java.lang.reflect.WildcardType

/**
 * Baut Server-Modelle, in denen jedes Feld einen eigenen Wert hat, und
 * vergleicht sie mit ihrer Ansicht — über Java-Reflexion, damit jede neue
 * Abbildung in vertrag/abbildung ohne eigenen Test mitgeprüft wird.
 */
object Beispielfueller {
    private var zaehler = 0

    /**
     * Die Dateien in vertrag/abbildung, beim Namen genannt: Unter Gradle
     * liegen die Hauptklassen in einem Jar, ein Ordner-Durchgang fand dort nichts.
     * Dass die Liste vollständig ist, prüft UiModellAbbildungTest am Quelltext.
     */
    val ABBILDUNGSDATEIEN = listOf(
        "EinzelAbbildungen", "FinanzAbbildungen", "GutscheinKlartextAbbildung", "HaushaltAbbildungen", "HintergrundAbbildungen",
        "KatalogAbbildungen", "KontoAbbildungen", "PreisAbbildungen", "SetAbbildungen", "TeileAbbildungen", "VerwaltungAbbildungen",
    )

    /** Alle `alsAnsicht(<vertrag.X>)` der Dateien in [ABBILDUNGSDATEIEN]. */
    fun abbildungen(): List<Method> {
        return ABBILDUNGSDATEIEN.map { Class.forName("ch.brickinventoryapp.vertrag.abbildung.${it}Kt") }
            .flatMap { k -> k.methods.filter { it.name == "alsAnsicht" && it.parameterCount == 1 } }
            .filter { it.parameterTypes[0].name.startsWith("ch.brickinventoryapp.vertrag.") && !it.parameterTypes[0].isEnum }
            .sortedBy { it.parameterTypes[0].name }
    }

    /** Ein Wert vom Typ [typ]; Datenklassen über ihren vollständigen Konstruktor, jedes Feld anders. */
    fun fuelle(typ: Type): Any? {
        val k = when (typ) {
            is Class<*> -> typ
            is ParameterizedType -> typ.rawType as Class<*>
            is WildcardType -> return fuelle(typ.upperBounds[0])
            else -> error("Typ $typ")
        }
        zaehler++
        return when {
            k == Int::class.javaPrimitiveType || k == Int::class.javaObjectType -> 100 + zaehler
            k == Long::class.javaPrimitiveType || k == Long::class.javaObjectType -> 1000L + zaehler
            k == Double::class.javaPrimitiveType || k == Double::class.javaObjectType -> zaehler + 0.25
            k == Float::class.javaPrimitiveType || k == Float::class.javaObjectType -> zaehler + 0.5f
            k == Boolean::class.javaPrimitiveType || k == Boolean::class.javaObjectType -> zaehler % 2 == 0
            k == String::class.java -> "w$zaehler"
            k.isEnum -> k.enumConstants.last()
            List::class.java.isAssignableFrom(k) -> {
                val t = (typ as ParameterizedType).actualTypeArguments[0]
                listOf(fuelle(t), fuelle(t))
            }
            Map::class.java.isAssignableFrom(k) ->
                mapOf("k$zaehler" to fuelle((typ as ParameterizedType).actualTypeArguments[1]))
            else -> {
                val c = k.declaredConstructors
                    .filter { kon -> kon.parameterTypes.none { it.name.endsWith("ConstructorMarker") } }
                    .maxBy { it.parameterCount }
                c.isAccessible = true
                c.newInstance(*c.genericParameterTypes.map { fuelle(it) }.toTypedArray())
            }
        }
    }

    /**
     * Vergleicht die gleichnamigen Getter von [dto] und [ansicht], verschachtelt;
     * Getter ohne Gegenstück landen in [ohne]. Gibt die Zahl der verglichenen Felder.
     */
    fun vergleiche(dto: Any?, ansicht: Any?, pfad: String, ohne: MutableSet<String>): Int {
        if (ansicht == null || dto == null || !ansicht.javaClass.name.startsWith("ch.brickinventoryapp.model.ui.model.")) {
            assertEquals(pfad, dto, ansicht)
            return 1
        }
        val k = ansicht.javaClass
        var n = 0
        val getter = k.methods.filter {
            it.parameterCount == 0 && it.declaringClass == k && (it.name.startsWith("get") || it.name.startsWith("is"))
        }
        for (g in getter) {
            val gegen = dto.javaClass.methods.firstOrNull { it.name == g.name && it.parameterCount == 0 }
            if (gegen == null) { ohne += "${dto.javaClass.simpleName}.${g.name}"; continue }
            n += vergleicheWert(gegen.invoke(dto), g.invoke(ansicht), "$pfad.${g.name}", ohne)
        }
        return n
    }

    /** Listen und Maps Eintrag für Eintrag, alles andere über [vergleiche]. */
    private fun vergleicheWert(d: Any?, a: Any?, pfad: String, ohne: MutableSet<String>): Int = when {
        a is List<*> && d is List<*> -> {
            assertEquals("$pfad (Länge)", d.size, a.size)
            a.indices.sumOf { vergleiche(d[it], a[it], "$pfad[$it]", ohne) }
        }
        a is Map<*, *> && d is Map<*, *> -> {
            assertEquals("$pfad (Schlüssel)", d.keys, a.keys)
            a.keys.sumOf { vergleiche(d[it], a[it], "$pfad[$it]", ohne) }
        }
        else -> vergleiche(d, a, pfad, ohne)
    }
}
