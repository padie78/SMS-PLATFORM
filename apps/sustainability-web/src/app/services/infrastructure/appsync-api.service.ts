import { Injectable, inject } from '@angular/core';
import { generateClient } from 'aws-amplify/api';
import { Observable } from 'rxjs';
import type {
  ConfirmInvoiceInput,
  ConfirmInvoiceResult,
  CreateInvoiceInput,
  CreateInvoiceResult,
  GetPrecalculatedKpiData,
  InvoiceAssignmentResolution,
  InvoiceUpdatedGraphqlEvent,
  LinkAssetExternalIdentifierInput,
  PresignedUrlResponse,
  ResolveInvoiceAssignmentInput
} from '../../core/models/api/appsync-api.models';
import { LoggerService } from '../utils/logger.service';

type GraphqlQueryResult<TData> = { data?: TData };

@Injectable({ providedIn: 'root' })
export class AppSyncApiService {
  private readonly client = generateClient();
  private readonly logger = inject(LoggerService);

  private async executeGraphql<TData>(
    query: string,
    variables?: Record<string, unknown>
  ): Promise<TData> {
    try {
      const raw: unknown = await this.client.graphql(
        variables === undefined
          ? { query, authMode: 'userPool' }
          : { query, variables, authMode: 'userPool' }
      );
      const response = raw as GraphqlQueryResult<TData>;
      if (!response.data) {
        throw new Error('GraphQL returned no data payload');
      }
      return response.data;
    } catch (e: unknown) {
      throw e;
    }
  }

  async getPresignedUrl(fileName: string, fileType: string, invoiceId: string): Promise<PresignedUrlResponse> {
    const cleanFileName = fileName.split('\\').pop()?.split('/').pop() ?? fileName;

    const mutation = `
      mutation GetUrl($name: String!, $type: String!, $id: String!) {
        getPresignedUrl(fileName: $name, fileType: $type, invoiceId: $id) {
          uploadURL
          key
          invoiceId
        }
      }
    `;

    const data = await this.executeGraphql<{ getPresignedUrl: PresignedUrlResponse }>(mutation, {
      name: cleanFileName,
      type: fileType,
      id: invoiceId
    });

    if (!data.getPresignedUrl) {
      throw new Error('getPresignedUrl returned empty');
    }
    this.logger.debug('Presigned URL obtained', { invoiceId: data.getPresignedUrl.invoiceId });
    return data.getPresignedUrl;
  }

  async createInvoice(input: CreateInvoiceInput): Promise<CreateInvoiceResult> {
    const mutation = `
      mutation CreateInvoice($input: CreateInvoiceInput!) {
        createInvoice(input: $input) {
          id
          status
          storageKey
        }
      }
    `;

    const data = await this.executeGraphql<{ createInvoice: CreateInvoiceResult }>(mutation, {
      input
    });

    if (!data.createInvoice) {
      throw new Error('createInvoice returned empty');
    }
    return data.createInvoice;
  }

  onInvoiceUpdated(_invoiceId: string): Observable<InvoiceUpdatedGraphqlEvent> {
    const subscription = `
      subscription OnInvoiceUpdated {
        onInvoiceUpdated {
          id
          status
          extractedData
          message
        }
      }
    `;

    return this.client.graphql({
      query: subscription,
      authMode: 'userPool'
    }) as Observable<InvoiceUpdatedGraphqlEvent>;
  }

  async resolveInvoiceAssignment(input: ResolveInvoiceAssignmentInput): Promise<InvoiceAssignmentResolution> {
    const query = `
      query ResolveInvoiceAssignment($input: ResolveInvoiceAssignmentInput!) {
        resolveInvoiceAssignment(input: $input) {
          matched
          matchTier
          regionId
          branchId
          buildingId
          assetId
          meterId
          costCenterId
        }
      }
    `;
    const data = await this.executeGraphql<{ resolveInvoiceAssignment: InvoiceAssignmentResolution }>(query, {
      input
    });
    if (!data.resolveInvoiceAssignment) {
      throw new Error('resolveInvoiceAssignment returned empty');
    }
    return data.resolveInvoiceAssignment;
  }

  async linkAssetExternalIdentifier(
    assetId: string,
    input: LinkAssetExternalIdentifierInput
  ): Promise<{ success: boolean; message?: string | null; id?: string | null }> {
    const mutation = `
      mutation LinkAssetExternalIdentifier($assetId: ID!, $input: LinkAssetExternalIdentifierInput!) {
        linkAssetExternalIdentifier(assetId: $assetId, input: $input) {
          success
          message
          id
        }
      }
    `;
    const data = await this.executeGraphql<{
      linkAssetExternalIdentifier: { success: boolean; message?: string | null; id?: string | null };
    }>(mutation, { assetId, input });
    if (!data.linkAssetExternalIdentifier) {
      throw new Error('linkAssetExternalIdentifier returned empty');
    }
    return data.linkAssetExternalIdentifier;
  }

  async confirmInvoice(invoiceId: string, input: ConfirmInvoiceInput): Promise<ConfirmInvoiceResult> {
    const mutation = `
      mutation ConfirmInvoice($id: ID!, $input: ConfirmInvoiceInput!) {
        confirmInvoice(id: $id, input: $input) {
          success
          message
          id
        }
      }
    `;

    const data = await this.executeGraphql<{ confirmInvoice: ConfirmInvoiceResult }>(mutation, {
      id: invoiceId,
      input
    });

    if (!data.confirmInvoice) {
      throw new Error('confirmInvoice returned empty');
    }
    return data.confirmInvoice;
  }

  async getYearlyKpi(year: string): Promise<Array<{ id: string; source: string; value: number; unit: string }>> {
    const query = `
      query GetPrecalc($year: String!) {
        getPrecalculatedKPI(year: $year) {
          id
          ghg_total_co2e_kg
          consumption_elec_val
          consumption_gas_val
          last_updated
        }
      }
    `;
    const data = await this.executeGraphql<GetPrecalculatedKpiData>(query, { year });
    const kpi = data.getPrecalculatedKPI;
    if (!kpi) return [];

    const rows = [
      {
        id: `${kpi.id}#co2e`,
        source: 'Total CO2e',
        value: Number(kpi.ghg_total_co2e_kg ?? 0),
        unit: 'kg'
      },
      {
        id: `${kpi.id}#elec`,
        source: 'Electricity consumption',
        value: Number(kpi.consumption_elec_val ?? 0),
        unit: 'kWh'
      },
      {
        id: `${kpi.id}#gas`,
        source: 'Gas consumption',
        value: Number(kpi.consumption_gas_val ?? 0),
        unit: 'kWh'
      }
    ];

    return rows.filter((r) => Number.isFinite(r.value));
  }

  /** Centros de costo (analytics resolver; payload AWSJSON heterogéneo). */
  async getCostCenters(): Promise<unknown[]> {
    const query = `
      query GetCostCenters {
        getCostCenters
      }
    `;
    const data = await this.executeGraphql<{ getCostCenters: unknown }>(query);
    const raw = data.getCostCenters;
    if (raw == null) return [];
    return Array.isArray(raw) ? raw : [raw];
  }

  /** Tarifas por sucursal (analytics resolver). */
  async getTariffsByBranch(branchId: string): Promise<unknown[]> {
    const query = `
      query GetTariffsByBranch($branchId: ID!) {
        getTariffsByBranch(branchId: $branchId)
      }
    `;
    const data = await this.executeGraphql<{ getTariffsByBranch: unknown }>(query, {
      branchId
    });
    const raw = data.getTariffsByBranch;
    if (raw == null) return [];
    return Array.isArray(raw) ? raw : [raw];
  }
}
