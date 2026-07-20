import unittest
from unittest.mock import patch

import server


class RetrievalModeApiTest(unittest.TestCase):
    def setUp(self):
        self.client = server.app.test_client()

    def test_rejects_unknown_retrieval_mode(self):
        response = self.client.post('/search', json={
            'question': '攀西钒钛磁铁矿',
            'top_k': 5,
            'retrieval_mode': 'bm25',
        })
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()['code'], 'INVALID_RETRIEVAL_MODE')

    def test_explicit_tfidf_mode_calls_tfidf_search(self):
        with patch.object(server, '_is_tfidf_available', return_value=(True, None)), \
             patch.object(server, '_search_tfidf', return_value={'mode': 'tfidf'}) as search_tfidf:
            response = self.client.post('/search', json={
                'question': '攀西钒钛磁铁矿',
                'top_k': 7,
                'retrieval_mode': 'tfidf',
            })
        self.assertEqual(response.status_code, 200)
        search_tfidf.assert_called_once_with('攀西钒钛磁铁矿', 7)

    def test_unavailable_bge_returns_503_without_tfidf_fallback(self):
        with patch.object(server, '_is_bge_available', return_value=(False, 'BGE 向量尚未加载')), \
             patch.object(server, '_search_tfidf') as search_tfidf:
            response = self.client.post('/search', json={
                'question': '攀西钒钛磁铁矿',
                'top_k': 5,
                'retrieval_mode': 'bge',
            })
        self.assertEqual(response.status_code, 503)
        payload = response.get_json()
        self.assertEqual(payload['code'], 'RETRIEVAL_MODE_UNAVAILABLE')
        self.assertEqual(payload['mode'], 'bge')
        self.assertIn('尚未加载', payload['reason'])
        search_tfidf.assert_not_called()

    def test_health_exposes_each_index_status(self):
        response = self.client.get('/health')
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertIn('bge', payload['retrieval'])
        self.assertIn('tfidf', payload['retrieval'])
        self.assertIn('available_modes', payload['retrieval'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
