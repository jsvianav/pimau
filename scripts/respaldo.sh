#!/bin/sh
# Respaldo diario de la base de datos de PIMAU.
# Genera un volcado comprimido por día y borra los de más de 7 días.
# Para restaurar: pg_restore --clean -d pimau respaldos/pimau_AAAAMMDD.dump
set -eu
while true; do
  archivo="/respaldos/pimau_$(date +%Y%m%d).dump"
  if pg_dump --format=custom --file="$archivo.tmp"; then
    mv "$archivo.tmp" "$archivo"
    echo "$(date -Iseconds) respaldo creado: $archivo"
  else
    rm -f "$archivo.tmp"
    echo "$(date -Iseconds) error al crear el respaldo" >&2
  fi
  find /respaldos -name 'pimau_*.dump' -mtime +7 -delete
  sleep 86400
done
