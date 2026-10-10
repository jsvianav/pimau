import { describe, expect, it } from "vitest";
import { agruparEstaciones, antiguedad, claveEstacion, estadoMasReciente, formatearFecha, formatearNumero, restarDias, textoSobre } from "./util.js";

const punto = (id, nombre, fuente, lon, lat, parametros = {}) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [lon, lat] },
  properties: { id, nombre, fuente, parametros },
});

describe("agruparEstaciones", () => {
  it("une la misma estación publicada por dos fuentes y usa las coordenadas oficiales", () => {
    const grupos = agruparEstaciones({ features: [
      // El IDEAM publica Era Obrero con las coordenadas de Base Aérea.
      punto(1, "Era Obrero", "IDEAM - datos.gov.co", -76.50654, 3.45732),
      punto(2, "ERA - Obrero", "Datos Abiertos de Cali (DAGMA)", -76.51908, 3.44759),
      punto(3, "Pance", "Datos Abiertos de Cali (DAGMA)", -76.5312, 3.3045),
    ] });
    expect(grupos).toHaveLength(2);
    const era = grupos.find((g) => g.nombre === "ERA - Obrero");
    expect(era.registros.map((r) => r.id)).toEqual([1, 2]);
    expect(era.coordenadas).toEqual([-76.51908, 3.44759]);
  });
  it("normaliza los nombres de las estaciones", () => {
    expect(claveEstacion("Transitoria EDB Navarro")).toBe(claveEstacion("Transitoria-Navarro"));
    expect(claveEstacion("Universidad Del Valle")).toBe(claveEstacion("Universidad del Valle"));
    expect(claveEstacion("Base Aérea")).toBe("base aerea");
  });
});

describe("estadoMasReciente", () => {
  it("prefiere el ICA más reciente entre las fuentes", () => {
    const [grupo] = agruparEstaciones({ features: [
      punto(1, "A", "Cali", -76.5, 3.4, { PM25: { instante: "2020-01-01T05:00:00+00:00", instante_ica: "2020-01-01T05:00:00+00:00", categoria: "Buena" } }),
      punto(2, "A", "IDEAM", -76.5, 3.4, { PM25: { instante: "2022-06-15T05:00:00+00:00", instante_ica: "2022-06-10T05:00:00+00:00", categoria: "Aceptable" } }),
      punto(3, "A", "Otra", -76.5, 3.4, { PM25: { instante: "2023-01-01T05:00:00+00:00", instante_ica: null, categoria: null } }),
    ] });
    expect(estadoMasReciente(grupo, "PM25").registro.fuente).toBe("IDEAM");
    expect(estadoMasReciente(grupo, "PM10")).toBeNull();
  });
});

describe("formatos", () => {
  it("muestra las fechas en hora de Colombia", () => {
    expect(formatearFecha("2025-01-01T05:00:00+00:00")).toMatch(/01.*ene.*2025.*00:00/);
  });
  it("expresa la antigüedad del dato", () => {
    expect(antiguedad("2020-01-01T00:00:00Z", new Date("2026-10-09T00:00:00Z"))).toBe("hace 6 años");
    expect(antiguedad("2026-09-30T00:00:00Z", new Date("2026-10-09T00:00:00Z"))).toBe("hace 9 días");
  });
  it("elige texto oscuro sobre amarillo y claro sobre marrón", () => {
    expect(textoSobre("#FFFF00")).toBe("#1a1a1a");
    expect(textoSobre("#7E0023")).toBe("#ffffff");
  });
  it("usa coma decimal", () => {
    expect(formatearNumero(14.25)).toBe("14,3");
    expect(formatearNumero(null)).toBe("—");
  });
  it("resta días a una fecha", () => {
    expect(restarDias("2025-01-01", 30)).toBe("2024-12-02");
  });
});
