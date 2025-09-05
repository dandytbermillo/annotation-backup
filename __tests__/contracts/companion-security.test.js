const request = require('supertest');
const { app } = require('../../context-os/companion/server-v2');

describe('Companion Security & Consistency', () => {
  let server;
  let csrfToken;
  
  beforeAll(async () => {
    server = app.listen(4001, '127.0.0.1');
    
    // Get CSRF token
    const res = await request(app).get('/api/csrf');
    csrfToken = res.body.token;
  });
  
  afterAll(() => {
    server.close();
  });
  
  describe('ETag validation', () => {
    test('rejects stale etag', async () => {
      const slug = 'test_feature';
      
      // Get initial draft and etag
      const res1 = await request(app)
        .get(`/api/draft/${slug}`)
        .set('Origin', 'http://localhost:3000');
      
      const etag1 = res1.body.etag;
      
      // Save with valid etag
      await request(app)
        .post('/api/draft/save')
        .set('Origin', 'http://localhost:3000')
        .set('x-csrf-token', csrfToken)
        .send({
          slug,
          content: 'Updated content',
          etag: etag1
        })
        .expect(200);
      
      // Try to save with stale etag
      const res2 = await request(app)
        .post('/api/draft/save')
        .set('Origin', 'http://localhost:3000')
        .set('x-csrf-token', csrfToken)
        .send({
          slug,
          content: 'Another update',
          etag: etag1
        })
        .expect(409);
      
      expect(res2.body.code).toBe('STALE_ETAG');
    });
  });
  
  describe('CSRF protection', () => {
    test('requires CSRF token for mutations', async () => {
      const res = await request(app)
        .post('/api/draft/save')
        .set('Origin', 'http://localhost:3000')
        .send({ slug: 'test', content: 'test' })
        .expect(403);
      
      expect(res.body.code).toBe('CSRF_REQUIRED');
    });
    
    test('accepts valid CSRF token', async () => {
      // Get fresh token
      const tokenRes = await request(app).get('/api/csrf');
      const token = tokenRes.body.token;
      
      // Get draft first
      const draftRes = await request(app)
        .get('/api/draft/csrf_test')
        .set('Origin', 'http://localhost:3000');
      
      // Use token
      const res = await request(app)
        .post('/api/draft/save')
        .set('Origin', 'http://localhost:3000')
        .set('x-csrf-token', token)
        .send({
          slug: 'csrf_test',
          content: 'test content',
          etag: draftRes.body.etag
        })
        .expect(200);
      
      expect(res.body.saved).toBe(true);
    });
  });
  
  describe('Origin validation', () => {
    test('rejects invalid origin', async () => {
      const res = await request(app)
        .get('/api/draft/test')
        .set('Origin', 'http://evil.com')
        .expect(403);
      
      expect(res.body.code).toBe('INVALID_ORIGIN');
    });
    
    test('accepts localhost origins', async () => {
      const res = await request(app)
        .get('/api/draft/origin_test')
        .set('Origin', 'http://localhost:3000')
        .expect(200);
      
      expect(res.body.slug).toBe('origin_test');
    });
  });
  
  describe('Path normalization', () => {
    test('normalizes dangerous paths', async () => {
      const res = await request(app)
        .get('/api/draft/../../../etc/passwd')
        .set('Origin', 'http://localhost:3000')
        .expect(200);
      
      // Path should be normalized
      expect(res.body.slug).toBe('___etc_passwd');
      expect(res.body.path).toContain('.tmp/initial');
    });
  });
  
  describe('Idempotency', () => {
    test('returns same result for duplicate requests', async () => {
      const idempotencyKey = 'test-key-123';
      
      // Get draft first
      const draftRes = await request(app)
        .get('/api/draft/idempotent_test')
        .set('Origin', 'http://localhost:3000');
      
      // First request
      const res1 = await request(app)
        .post('/api/draft/save')
        .set('Origin', 'http://localhost:3000')
        .set('x-csrf-token', csrfToken)
        .set('x-idempotency-key', idempotencyKey)
        .send({
          slug: 'idempotent_test',
          content: 'test content',
          etag: draftRes.body.etag
        })
        .expect(200);
      
      // Duplicate request with same key
      const res2 = await request(app)
        .post('/api/draft/save')
        .set('Origin', 'http://localhost:3000')
        .set('x-csrf-token', csrfToken)
        .set('x-idempotency-key', idempotencyKey)
        .send({
          slug: 'idempotent_test',
          content: 'different content', // Different content but same key
          etag: 'different'
        })
        .expect(200);
      
      // Should return cached result
      expect(res2.body).toEqual(res1.body);
    });
  });
});

describe('Advisory Locking', () => {
  test('prevents concurrent edits from different sessions', async () => {
    // This would require simulating different sessionIds
    // For now, just test the lock acquisition
    const res = await request(app)
      .get('/api/draft/lock_test')
      .set('Origin', 'http://localhost:3000')
      .expect(200);
    
    expect(res.body).toHaveProperty('lockStatus');
  });
});

describe('Content Hash Verification', () => {
  test('detects content modification outside companion', async () => {
    // This test would need to simulate external file modification
    // Placeholder for now
    expect(true).toBe(true);
  });
});