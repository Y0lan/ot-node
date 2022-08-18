const axios = require('axios');
const OtTripleStore = require('../ot-triple-store');

class OtFuseki extends OtTripleStore {
    initializeSparqlEndpoints(url, repository) {
        this.sparqlEndpoint = `${url}/${repository}/sparql`;
        this.sparqlEndpointUpdate = `${url}/${repository}/update`;
    }

    async healthCheck() {
        try {
            const response = await axios.get(`${this.config.url}/$/ping`, {});
            if (response.data !== null) {
                return true;
            }
            return false;
        } catch (e) {
            return false;
        }
    }

    getName() {
        return 'OtFuseki';
    }
}

module.exports = OtFuseki;
