-- Datos de entrada de agrupamiento.py. Se ejecutan con:
--   docker compose exec -T db psql -U pimau -d pimau -c "\copy (<consulta>) TO STDOUT WITH CSV HEADER" > archivo.csv
-- Solo se usan mediciones con bandera 'valido'.

-- perfil_horario.csv: PM2.5 promedio de cada hora del día (hora de Colombia) por estación.
SELECT e.id, e.nombre, f.nombre AS fuente, ST_X(e.ubicacion) lon, ST_Y(e.ubicacion) lat,
       extract(hour from m.instante AT TIME ZONE 'America/Bogota')::int AS hora,
       avg(m.valor) AS pm25, count(*) AS n
FROM medicion m JOIN estacion e ON e.id = m.estacion_id JOIN fuente f ON f.id = e.fuente_id
JOIN parametro p ON p.id = m.parametro_id
WHERE p.codigo = 'PM25' AND m.bandera = 'valido'
GROUP BY 1, 2, 3, 4, 5, 6;

-- diario.csv: promedio diario (suma, para la lluvia) de cada variable, con al menos 18 horas válidas.
WITH d AS (
  SELECT e.id, e.nombre, f.nombre AS fuente, (m.instante AT TIME ZONE 'America/Bogota')::date AS dia, p.codigo,
         CASE WHEN p.codigo = 'LLUVIA' THEN sum(m.valor) ELSE avg(m.valor) END AS valor, count(*) AS horas
  FROM medicion m JOIN estacion e ON e.id = m.estacion_id JOIN fuente f ON f.id = e.fuente_id
  JOIN parametro p ON p.id = m.parametro_id
  WHERE p.codigo IN ('PM25', 'TEMP', 'HUM', 'VV', 'LLUVIA') AND m.bandera = 'valido'
  GROUP BY 1, 2, 3, 4, 5)
SELECT * FROM d WHERE horas >= 18;
