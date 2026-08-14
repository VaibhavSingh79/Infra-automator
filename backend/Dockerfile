# 1. Use the newer Python 3.12 image (based on Amazon Linux 2023)

FROM public.ecr.aws/lambda/python:3.12

# 2. Install explicit build tools and dependencies using dnf (microdnf)

RUN dnf install -y gcc gcc-c++ make python3-devel git && \
    dnf clean all
# 3. Copy requirements

COPY requirements.txt ${LAMBDA_TASK_ROOT}

# 4. Install dependencies

# We upgrade pip first to handle modern wheels better

RUN pip install --upgrade pip && \

    pip install --no-cache-dir -r requirements.txt

# 5. Copy backend code

COPY . ${LAMBDA_TASK_ROOT}

# 6. Set the handler

CMD ["main.handler"]
 