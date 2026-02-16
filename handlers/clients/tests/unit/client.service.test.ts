import { describe, it, expect, beforeEach } from 'vitest';
import { ClientService } from '../../services/client.service';
import { CreateClientRequest } from '../../types/client-request.types';
import { ClientStatus } from '../../enums/client-status.enum';
import { getTestContainer, getMockDynamoDBUtil } from '../setup';
import { mockClient, mockExistingClient } from '../fixtures/client.fixtures';

describe('ClientService', () => {
  let clientService: ClientService;
  let mockDynamoDBUtil: any;

  beforeEach(() => {
    const container = getTestContainer();
    container.bind('ClientService').to(ClientService);
    clientService = container.get<ClientService>('ClientService');
    mockDynamoDBUtil = getMockDynamoDBUtil();
  });

  describe('createClient', () => {
    it('should create a new client successfully', async () => {
      const request: CreateClientRequest = {
        name: 'Test Client',
        email: 'test@example.com',
      };

      mockDynamoDBUtil.query.mockResolvedValueOnce({
        items: [],
        count: 0,
      });

      mockDynamoDBUtil.put.mockResolvedValueOnce(undefined);

      const result = await clientService.createClient(request);

      expect(result.result).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.name).toBe(request.name);
      expect(result.data?.email).toBe(request.email);
      expect(result.data?.status).toBe(ClientStatus.ACTIVE);
      expect(result.data?.id).toMatch(/^CL[A-Z0-9]{8}$/);
      expect(mockDynamoDBUtil.put).toHaveBeenCalledTimes(1);
    });

    it('should return error if email already exists', async () => {
      const request: CreateClientRequest = {
        name: 'Test Client',
        email: 'existing@example.com',
      };

      mockDynamoDBUtil.query.mockResolvedValueOnce({
        items: [mockExistingClient],
        count: 1,
      });

      const result = await clientService.createClient(request);

      expect(result.result).toBe(false);
      expect(result.error).toContain('already exists');
      expect(mockDynamoDBUtil.put).not.toHaveBeenCalled();
    });
  });

  describe('getClient', () => {
    it('should retrieve a client by ID', async () => {
      mockDynamoDBUtil.get.mockResolvedValueOnce(mockClient);

      const result = await clientService.getClient('CLABCDEFGHIJ');

      expect(result.result).toBe(true);
      expect(result.data).toEqual(mockClient);
      expect(mockDynamoDBUtil.get).toHaveBeenCalledWith({
        TableName: 'test-clients-table',
        Key: { id: 'CLABCDEFGHIJ' },
      });
    });

    it('should return error result if client not found', async () => {
      mockDynamoDBUtil.get.mockResolvedValueOnce(null);

      const result = await clientService.getClient('CLZZZZZZZZZZ');

      expect(result.result).toBe(false);
      expect(result.error).toContain('not found');
    });
  });
});
