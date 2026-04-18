import os, sys
import json

from flask import Flask, Response
from flask import request, jsonify

from flask_cors import CORS, cross_origin

app = Flask(__name__)
cors = CORS(app, resources={r"/response": {"origins": "*"}})
app.config['CORS_HEADERS'] = 'Content-Type'
app.config["DEBUG"] = True

class DataStorage(object):

    def __init__(self, filename='responses.jsonl'):
        self.filename = filename

    def appendResponse(self, response):
        with open(self.filename, 'a', encoding='utf-8') as fl:
            fl.write('{}\n'.format(json.dumps(response)))


DS = DataStorage()

@app.route('/response', methods=['POST'])
@cross_origin(origin='*',headers=['access-control-allow-origin','Content-Type'])
def collect_response():
    resp = request.get_json(force=True, silent=True)
    if resp is None and request.data:
        resp = json.loads(request.data.decode('utf-8'))
    
    if resp:
        print('[New data] => {}'.format(json.dumps(resp)))
        DS.appendResponse(resp)
        return Response(status=200)
    return Response(status=400)


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5050)