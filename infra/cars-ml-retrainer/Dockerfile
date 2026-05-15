FROM public.ecr.aws/lambda/python:3.11

COPY requirements-ml.txt ${LAMBDA_TASK_ROOT}/
RUN pip install --no-cache-dir -r ${LAMBDA_TASK_ROOT}/requirements-ml.txt boto3

COPY scripts/train_cars_ml.py ${LAMBDA_TASK_ROOT}/
COPY scripts/retrain_cars_ml.py ${LAMBDA_TASK_ROOT}/
COPY src/lib/data/cars-ml ${LAMBDA_TASK_ROOT}/cars-ml-seed

ENV CARS_ML_OUTPUT_DIR=/tmp/cars-ml
ENV CARS_ML_PUBLISH_ENABLED=true

CMD ["retrain_cars_ml.handler"]
