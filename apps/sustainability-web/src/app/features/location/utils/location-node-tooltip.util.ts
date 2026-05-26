import type { SmsLocationNode, SmsLocationNodeMetadata } from '../../../core/models/sms-location-node.model';

function fmtNum(n: number, opts?: Intl.NumberFormatOptions): string {
  return n.toLocaleString(undefined, opts);
}

function pushLine(lines: string[], cond: unknown, line: string): void {
  if (cond) lines.push(line);
}

/** Tooltip multilínea: datos operativos por tipo + consumo + huella + fechas. */
export function buildLocationNodeTooltipText(node: SmsLocationNode): string {
  const meta: SmsLocationNodeMetadata = node.metadata ?? {};
  const lines: string[] = [];

  switch (node.type) {
    case 'ORGANIZATION':
      lines.push(`Organización · ${node.name}`);
      pushLine(lines, meta.code, `Código: ${meta.code}`);
      pushLine(lines, meta.description, `Descripción: ${meta.description}`);
      break;

    case 'REGION':
      lines.push(`Región · ${node.name}`);
      if (meta.countryCode) lines.push(`País: ${String(meta.countryCode).toUpperCase()}`);
      pushLine(lines, meta.code, `Código región: ${meta.code}`);
      if (
        meta.coordinates &&
        typeof meta.coordinates.lat === 'number' &&
        typeof meta.coordinates.lng === 'number'
      ) {
        lines.push(
          `Ubicación: ${fmtNum(meta.coordinates.lat, { maximumFractionDigits: 5 })}, ${fmtNum(meta.coordinates.lng, { maximumFractionDigits: 5 })}`
        );
      }
      pushLine(lines, meta.description, `Notas: ${meta.description}`);
      break;

    case 'BRANCH':
      lines.push(`Sucursal · ${node.name}`);
      pushLine(lines, meta.facilityType, `Tipo instalación: ${meta.facilityType}`);
      if (meta.isHeadquarters === true) lines.push('Sede central (HQ)');
      if (typeof meta.energyTarget === 'number') {
        lines.push(`Objetivo energético: ${fmtNum(meta.energyTarget)} kWh`);
      }
      pushLine(lines, meta.timezone, `Zona horaria: ${meta.timezone}`);
      if (
        meta.coordinates &&
        typeof meta.coordinates.lat === 'number' &&
        typeof meta.coordinates.lng === 'number'
      ) {
        lines.push(
          `Coordenadas: ${fmtNum(meta.coordinates.lat, { maximumFractionDigits: 5 })}, ${fmtNum(meta.coordinates.lng, { maximumFractionDigits: 5 })}`
        );
      }
      break;

    case 'BUILDING':
      lines.push(`Edificio · ${node.name}`);
      {
        const uso = meta.usageType ?? meta.usageTypeEnum;
        pushLine(lines, uso, `Uso declarado: ${uso}`);
      }
      pushLine(lines, meta.operationalStatus, `Estado operativo: ${meta.operationalStatus}`);
      if (typeof meta.m2Surface === 'number') {
        lines.push(`Superficie: ${fmtNum(meta.m2Surface)} m²`);
      }
      if (typeof meta.m3Volume === 'number') {
        lines.push(`Volumen: ${fmtNum(meta.m3Volume)} m³`);
      }
      if (typeof meta.yearBuilt === 'number') {
        lines.push(`Año construcción: ${meta.yearBuilt}`);
      }
      pushLine(lines, meta.hvacType, `HVAC: ${meta.hvacType}`);
      if (meta.hasBms === true) lines.push('BMS: sí');
      else if (meta.hasBms === false) lines.push('BMS: no');
      pushLine(lines, meta.mainFuelType, `Combustible principal: ${meta.mainFuelType}`);
      if (
        meta.coordinates &&
        typeof meta.coordinates.lat === 'number' &&
        typeof meta.coordinates.lng === 'number'
      ) {
        lines.push(
          `Ubicación: ${fmtNum(meta.coordinates.lat, { maximumFractionDigits: 5 })}, ${fmtNum(meta.coordinates.lng, { maximumFractionDigits: 5 })}`
        );
      }
      break;

    case 'COST_CENTER':
      lines.push(`Centro de costo · ${node.name}`);
      pushLine(lines, meta.externalId, `Código externo: ${meta.externalId}`);
      if (typeof meta.annualBudget === 'number') {
        const cur = meta.currency ?? 'USD';
        lines.push(`Presupuesto anual: ${fmtNum(meta.annualBudget)} ${cur}`);
      }
      pushLine(lines, meta.allocationMethod, `Método imputación: ${meta.allocationMethod}`);
      if (typeof meta.percentage === 'number') {
        lines.push(`Porcentaje asignado: ${meta.percentage}%`);
      }
      if (typeof meta.fiscalYear === 'number') {
        lines.push(`Ejercicio fiscal: ${meta.fiscalYear}`);
      }
      break;

    case 'ASSET':
      lines.push(`Activo · ${node.name}`);
      pushLine(lines, meta.assetType, `Tipo activo: ${meta.assetType}`);
      if (typeof meta.nominalPower_kw === 'number') {
        lines.push(`Potencia nominal: ${meta.nominalPower_kw} kW`);
      } else if (typeof meta.nominalPower === 'number') {
        lines.push(`Potencia nominal: ${meta.nominalPower} kW`);
      }
      pushLine(lines, meta.assetStatus, `Estado equipo: ${meta.assetStatus}`);
      if (meta.tags && typeof meta.tags === 'object') {
        const entries = Object.entries(meta.tags).slice(0, 6);
        if (entries.length > 0) {
          lines.push(`Etiquetas: ${entries.map(([k, v]) => `${k}=${v}`).join(', ')}`);
        }
      }
      break;

    case 'METER':
      lines.push(`Medidor · ${node.name}`);
      pushLine(lines, meta.meterType, `Tipo medición: ${meta.meterType}`);
      pushLine(lines, meta.meterStatus, `Estado medidor: ${meta.meterStatus}`);
      pushLine(lines, meta.serialNumber, `Serial: ${meta.serialNumber}`);
      pushLine(lines, meta.cups, `CUPS / ID red: ${meta.cups}`);
      if (meta.isMain === true) lines.push('Rol: medidor principal');
      pushLine(lines, meta.protocol, `Protocolo / integración: ${meta.protocol}`);
      {
        const iot = meta.iotName ?? meta.internalTag;
        pushLine(lines, iot, `IoT / tag: ${iot}`);
      }
      break;

    default:
      lines.push(node.name ?? 'Nodo');
  }

  if (node.status) {
    lines.push(`Estado SMS: ${node.status}`);
  }

  const c = node.consumption_data;
  const cLines: string[] = [];
  if (c) {
    if (typeof c.last30d_kwh === 'number') {
      cLines.push(`Últimos 30d · energía: ${fmtNum(c.last30d_kwh)} kWh`);
    }
    if (typeof c.last30d_cost_usd === 'number') {
      cLines.push(`Últimos 30d · costo (ref. USD): ${fmtNum(c.last30d_cost_usd, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`);
    }
    if (typeof c.last30d_co2e_kg === 'number') {
      cLines.push(`Últimos 30d · CO₂e: ${fmtNum(c.last30d_co2e_kg)} kg`);
    }
    if (c.lastUpdatedAt) {
      cLines.push(`Consumo actualizado: ${c.lastUpdatedAt}`);
    }
  }
  if (cLines.length > 0) {
    lines.push('');
    lines.push('— Energía & consumo —');
    lines.push(...cLines);
  }

  const e = node.environmental_impact;
  const eLines: string[] = [];
  if (e) {
    if (typeof e.scope1_co2e_kg === 'number') eLines.push(`Alcance 1: ${fmtNum(e.scope1_co2e_kg)} kg CO₂e`);
    if (typeof e.scope2_co2e_kg === 'number') eLines.push(`Alcance 2: ${fmtNum(e.scope2_co2e_kg)} kg CO₂e`);
    if (typeof e.scope3_co2e_kg === 'number') eLines.push(`Alcance 3: ${fmtNum(e.scope3_co2e_kg)} kg CO₂e`);
    if (typeof e.intensity_kgco2e_per_kwh === 'number') {
      eLines.push(`Intensidad: ${fmtNum(e.intensity_kgco2e_per_kwh, { maximumFractionDigits: 4 })} kg CO₂e / kWh`);
    }
    pushLine(eLines, e.methodology, `Metodología: ${e.methodology}`);
  }
  if (eLines.length > 0) {
    lines.push('');
    lines.push('— Huella (reporte) —');
    lines.push(...eLines);
  }

  const audit: string[] = [];
  if (node.created_at) audit.push(`Creado: ${node.created_at}`);
  if (node.updated_at) audit.push(`Modificado: ${node.updated_at}`);
  if (audit.length > 0) {
    lines.push('');
    lines.push('— Auditoría —');
    lines.push(...audit);
  }

  return lines.join('\n').trim();
}
